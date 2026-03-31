package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/net/http2"
)

// ─── Stats (cache-line padded — prevents false sharing between goroutines) ───

type Stats struct {
	sent    atomic.Int64
	_       [56]byte
	success atomic.Int64
	_       [56]byte
	fail    atomic.Int64
}

// ─── DNS Cache ────────────────────────────────────────────────────────────────

type dnsCache struct {
	mu    sync.RWMutex
	store map[string]string
}

func newDNSCache() *dnsCache { return &dnsCache{store: make(map[string]string)} }

func (d *dnsCache) resolve(host string) string {
	d.mu.RLock()
	ip, ok := d.store[host]
	d.mu.RUnlock()
	if ok {
		return ip
	}
	addrs, err := net.LookupHost(host)
	if err != nil || len(addrs) == 0 {
		return host
	}
	d.mu.Lock()
	d.store[host] = addrs[0]
	d.mu.Unlock()
	return addrs[0]
}

// ─── Pooled request body ─────────────────────────────────────────────────────
// net/http calls Body.Close() after sending — we return the reader to pool
// instead of GC-ing it. Zero allocations in the POST hot path.

type pooledBody struct {
	*bytes.Reader
	pool *sync.Pool
}

func (p *pooledBody) Close() error {
	p.pool.Put(p)
	return nil
}

// ─── Config ───────────────────────────────────────────────────────────────────

type Config struct {
	URL        string
	Workers    int
	Conns      int
	Duration   time.Duration
	Method     string
	Body       []byte
	Headers    http.Header // pre-canonicalized once at startup
	SkipVerify bool
	ForceHTTP1 bool
}

// ─── Blaster ─────────────────────────────────────────────────────────────────

type Blaster struct {
	cfg      *Config
	h2t      *http2.Transport // direct HTTP/2 transport (no net/http overhead)
	h1t      *http.Transport  // HTTP/1.1 fallback
	dns      *dnsCache
	stats    Stats
	baseReq  *http.Request // shared across workers — WithContext() cheaply forks it
	bodyPool sync.Pool     // reuse bytes.Reader for POST bodies
	drainCh  chan *http.Response
}

func NewBlaster(cfg *Config) *Blaster {
	b := &Blaster{
		cfg:     cfg,
		dns:     newDNSCache(),
		drainCh: make(chan *http.Response, cfg.Workers*4),
	}
	b.bodyPool = sync.Pool{New: func() any { return &pooledBody{Reader: bytes.NewReader(nil)} }}

	tlsCfg := &tls.Config{
		InsecureSkipVerify: cfg.SkipVerify,
		MinVersion:         tls.VersionTLS12,
		// Session tickets: avoid full TLS handshake CPU on reconnect
		ClientSessionCache: tls.NewLRUClientSessionCache(cfg.Conns * 8),
	}

	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, _ := net.SplitHostPort(addr)
		ip := b.dns.resolve(host)
		d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 60 * time.Second}
		conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip, port))
		if err != nil {
			return nil, err
		}
		applySocketOpts(conn)
		return conn, nil
	}

	if cfg.ForceHTTP1 {
		b.h1t = &http.Transport{
			TLSClientConfig:     tlsCfg,
			TLSNextProto:        make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
			MaxIdleConns:        cfg.Conns * 2,
			MaxIdleConnsPerHost: cfg.Conns,
			MaxConnsPerHost:     cfg.Conns,
			IdleConnTimeout:     90 * time.Second,
			DisableCompression:  true,
			DialContext:         dial,
		}
	} else {
		// Direct http2.Transport: skips the entire net/http.Transport layer.
		// No mutex contention from http.Transport, no redundant header normalization,
		// no per-roundtrip middleware chain. Pure HTTP/2 framing overhead only.
		b.h2t = &http2.Transport{
			TLSClientConfig:    tlsCfg,
			DisableCompression: true,
			ReadIdleTimeout:    30 * time.Second,
			PingTimeout:        15 * time.Second,
			// false = each connection can independently max out its stream count
			StrictMaxConcurrentStreams: false,
			DialTLSContext: func(ctx context.Context, network, addr string, cfg *tls.Config) (net.Conn, error) {
				rawConn, err := dial(ctx, network, addr)
				if err != nil {
					return nil, err
				}
				tlsConn := tls.Client(rawConn, cfg)
				if err := tlsConn.HandshakeContext(ctx); err != nil {
					rawConn.Close()
					return nil, err
				}
				return tlsConn, nil
			},
		}
	}

	// Build base request once. Workers call WithContext() — a struct copy (~280 bytes)
	// that SHARES the Header map pointer. No per-request header map allocation.
	// Compare: Clone() allocates a new Header map + copies all entries = ~4× more.
	b.baseReq, _ = http.NewRequest(cfg.Method, cfg.URL, nil)
	for k, v := range cfg.Headers {
		b.baseReq.Header[k] = v
	}

	return b
}

func (b *Blaster) roundTrip(req *http.Request) (*http.Response, error) {
	if b.h1t != nil {
		return b.h1t.RoundTrip(req)
	}
	return b.h2t.RoundTrip(req)
}

// startDrainWorkers: fixed pool with persistent 32KB buffers.
// Zero goroutine spawn per response. Zero buffer allocation per drain.
func (b *Blaster) startDrainWorkers() {
	n := b.cfg.Workers / 10
	if n < 50 {
		n = 50
	}
	if n > 500 {
		n = 500
	}
	for i := 0; i < n; i++ {
		buf := make([]byte, 32*1024)
		go func() {
			for resp := range b.drainCh {
				io.CopyBuffer(io.Discard, resp.Body, buf)
				resp.Body.Close()
			}
		}()
	}
}

func (b *Blaster) worker(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	done := ctx.Done()
	hasBody := len(b.cfg.Body) > 0

	for {
		select {
		case <-done:
			return
		default:
		}

		// WithContext: struct copy + new URL struct = ~280 bytes total.
		// Header map is SHARED (not copied) — the single biggest hot-path saving.
		req := b.baseReq.WithContext(ctx)

		if hasBody {
			pb := b.bodyPool.Get().(*pooledBody)
			pb.Reset(b.cfg.Body)
			pb.pool = &b.bodyPool
			req.Body = pb
			req.ContentLength = int64(len(b.cfg.Body))
		}

		b.stats.sent.Add(1)
		resp, err := b.roundTrip(req)
		if err != nil {
			b.stats.fail.Add(1)
			continue
		}
		b.stats.success.Add(1)

		select {
		case b.drainCh <- resp:
		default:
			// Drain channel full → RST_STREAM (immediate close).
			// This is acceptable under extreme load — server gets the request.
			resp.Body.Close()
		}
	}
}

func (b *Blaster) warmup() {
	fmt.Print("\033[33m[*] Warming up connections...\033[0m\r")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	sem := make(chan struct{}, b.cfg.Conns)
	for i := 0; i < b.cfg.Conns; i++ {
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer func() { <-sem; wg.Done() }()
			req := b.baseReq.WithContext(ctx)
			resp, err := b.roundTrip(req)
			if err != nil {
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}()
	}
	wg.Wait()

	b.stats.sent.Store(0)
	b.stats.success.Store(0)
	b.stats.fail.Store(0)
	fmt.Print("\033[2K")
}

func (b *Blaster) Run() {
	ctx, cancel := context.WithTimeout(context.Background(), b.cfg.Duration)
	defer cancel()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { <-sig; cancel() }()

	proto := "HTTP/2 (direct)"
	if b.cfg.ForceHTTP1 {
		proto = "HTTP/1.1"
	}

	fmt.Printf("\n\033[1;36m╔══════════════════════════════════════════════╗\033[0m\n")
	fmt.Printf("\033[1;36m║              BLAST — MAX RPS MODE            ║\033[0m\n")
	fmt.Printf("\033[1;36m╚══════════════════════════════════════════════╝\033[0m\n\n")
	fmt.Printf("  \033[1mTarget  :\033[0m %s\n", b.cfg.URL)
	fmt.Printf("  \033[1mProtocol:\033[0m %s\n", proto)
	fmt.Printf("  \033[1mMethod  :\033[0m %s\n", b.cfg.Method)
	fmt.Printf("  \033[1mWorkers :\033[0m %d\n", b.cfg.Workers)
	fmt.Printf("  \033[1mConns   :\033[0m %d\n", b.cfg.Conns)
	fmt.Printf("  \033[1mDuration:\033[0m %s\n", b.cfg.Duration)
	fmt.Println()

	b.startDrainWorkers()
	b.warmup()

	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < b.cfg.Workers; i++ {
		wg.Add(1)
		go b.worker(ctx, &wg)
	}

	go func() {
		var prevSent int64
		for ctx.Err() == nil {
			time.Sleep(time.Second)
			elapsed := time.Since(start)
			curSent := b.stats.sent.Load()
			curOK := b.stats.success.Load()
			curFail := b.stats.fail.Load()
			rps := float64(curSent - prevSent)
			prevSent = curSent
			left := b.cfg.Duration - elapsed
			if left < 0 {
				left = 0
			}
			fmt.Printf("\r\033[2K\033[1;32m RPS: %8.0f\033[0m | Sent: \033[33m%9d\033[0m | OK: \033[32m%9d\033[0m | Fail: \033[31m%7d\033[0m | %ds/%ds",
				rps, curSent, curOK, curFail,
				int(elapsed.Seconds()), int(b.cfg.Duration.Seconds()))
		}
	}()

	wg.Wait()

	elapsed := time.Since(start)
	totalSent := b.stats.sent.Load()
	totalOK := b.stats.success.Load()
	totalFail := b.stats.fail.Load()
	avgRPS := float64(totalSent) / elapsed.Seconds()
	successPct := 0.0
	if totalSent > 0 {
		successPct = float64(totalOK) / float64(totalSent) * 100
	}

	fmt.Printf("\n\n\033[1;36m┌─────────────────── RESULT ───────────────────┐\033[0m\n")
	fmt.Printf("\033[1;36m│\033[0m  Duration   : %-32.2fs\033[1;36m│\033[0m\n", elapsed.Seconds())
	fmt.Printf("\033[1;36m│\033[0m  Total Sent : %-32d\033[1;36m│\033[0m\n", totalSent)
	fmt.Printf("\033[1;36m│\033[0m  Success    : %-21d \033[32m(%.1f%%)\033[0m       \033[1;36m│\033[0m\n", totalOK, successPct)
	fmt.Printf("\033[1;36m│\033[0m  Failed     : %-32d\033[1;36m│\033[0m\n", totalFail)
	fmt.Printf("\033[1;36m│\033[0m  Avg RPS    : \033[1;32m%-32.0f\033[0m\033[1;36m│\033[0m\n", avgRPS)
	fmt.Printf("\033[1;36m└──────────────────────────────────────────────┘\033[0m\n\n")
}

// ─── main ─────────────────────────────────────────────────────────────────────

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	// GOGC=400: GC triggers at 4× heap growth (default 100% = 1×).
	// At 100k RPS, this reduces GC pauses from ~40/sec to ~10/sec.
	debug.SetGCPercent(400)

	urlFlag := flag.String("url", "", "Target URL (required)")
	workersFlag := flag.Int("workers", 1000, "Goroutine worker count")
	connsFlag := flag.Int("conns", 50, "Max connections per host")
	durationFlag := flag.Duration("duration", 30*time.Second, "Duration (e.g. 30s, 1m)")
	methodFlag := flag.String("method", "GET", "HTTP method")
	bodyFlag := flag.String("body", "", "Request body")
	headersFlag := flag.String("headers", "", "Headers: \"Key:Value,Key2:Value2\"")
	skipVerifyFlag := flag.Bool("skip-verify", true, "Skip TLS verification")
	http1Flag := flag.Bool("http1", false, "Force HTTP/1.1")
	flag.Parse()

	if *urlFlag == "" {
		fmt.Fprintln(os.Stderr, "Error: -url is required")
		flag.Usage()
		os.Exit(1)
	}

	headers := make(http.Header)
	headers["User-Agent"] = []string{"Mozilla/5.0"}
	headers["Accept"] = []string{"*/*"}
	if *headersFlag != "" {
		for _, h := range strings.Split(*headersFlag, ",") {
			h = strings.TrimSpace(h)
			idx := strings.IndexByte(h, ':')
			if idx > 0 {
				k := http.CanonicalHeaderKey(strings.TrimSpace(h[:idx]))
				v := strings.TrimSpace(h[idx+1:])
				headers[k] = []string{v}
			}
		}
	}

	NewBlaster(&Config{
		URL:        *urlFlag,
		Workers:    *workersFlag,
		Conns:      *connsFlag,
		Duration:   *durationFlag,
		Method:     strings.ToUpper(*methodFlag),
		Body:       []byte(*bodyFlag),
		Headers:    headers,
		SkipVerify: *skipVerifyFlag,
		ForceHTTP1: *http1Flag,
	}).Run()
}
