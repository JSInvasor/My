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
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/net/http2"
)

// ─── Stats ────────────────────────────────────────────────────────────────────

type Stats struct {
	sent    atomic.Int64
	success atomic.Int64
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

// ─── Config ───────────────────────────────────────────────────────────────────

type Config struct {
	URL        string
	Workers    int
	Conns      int
	Duration   time.Duration
	Method     string
	Body       []byte
	Headers    http.Header // pre-canonicalized
	SkipVerify bool
	ForceHTTP1 bool
}

// ─── Blaster ─────────────────────────────────────────────────────────────────

type Blaster struct {
	cfg    *Config
	client *http.Client
	dns    *dnsCache
	stats  Stats
}

func NewBlaster(cfg *Config) *Blaster {
	b := &Blaster{cfg: cfg, dns: newDNSCache()}
	b.client = b.buildClient()
	return b
}

func (b *Blaster) buildClient() *http.Client {
	tlsCfg := &tls.Config{
		InsecureSkipVerify: b.cfg.SkipVerify,
		MinVersion:         tls.VersionTLS12,
		// Session resumption: reuse TLS tickets to avoid full handshakes
		ClientSessionCache: tls.NewLRUClientSessionCache(b.cfg.Conns * 4),
	}

	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, _ := net.SplitHostPort(addr)
		ip := b.dns.resolve(host)
		d := &net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 60 * time.Second,
		}
		conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip, port))
		if err != nil {
			return nil, err
		}
		applySocketOpts(conn) // TCP_NODELAY, TCP_QUICKACK, large buffers
		return conn, nil
	}

	if b.cfg.ForceHTTP1 {
		t := &http.Transport{
			TLSClientConfig:     tlsCfg,
			TLSNextProto:        make(map[string]func(authority string, c *tls.Conn) http.RoundTripper), // disable HTTP/2
			MaxIdleConns:        b.cfg.Conns * 2,
			MaxIdleConnsPerHost: b.cfg.Conns,
			MaxConnsPerHost:     b.cfg.Conns,
			IdleConnTimeout:     90 * time.Second,
			DisableCompression:  true,
			DisableKeepAlives:   false,
			DialContext:         dial,
		}
		return &http.Client{Transport: t}
	}

	// HTTP/2: explicit MaxConnsPerHost controls how many TCP connections we open.
	// Each connection multiplexes all in-flight streams.
	// Workers >> Conns: many goroutines share few connections via HTTP/2 multiplexing.
	t := &http.Transport{
		TLSClientConfig:     tlsCfg,
		MaxIdleConns:        b.cfg.Conns * 2,
		MaxIdleConnsPerHost: b.cfg.Conns,
		MaxConnsPerHost:     b.cfg.Conns,
		IdleConnTimeout:     90 * time.Second,
		ForceAttemptHTTP2:   true,
		DisableCompression:  true,
		DialContext:         dial,
	}

	// ConfigureTransports returns the http2.Transport for fine-grained tuning.
	h2t, err := http2.ConfigureTransports(t)
	if err == nil {
		h2t.ReadIdleTimeout = 30 * time.Second
		h2t.PingTimeout = 15 * time.Second
		// Disable strict per-connection stream cap so workers can always send.
		h2t.StrictMaxConcurrentStreams = false
	}

	return &http.Client{Transport: t}
}

func (b *Blaster) newRequest(ctx context.Context) *http.Request {
	var body io.Reader
	if len(b.cfg.Body) > 0 {
		body = bytes.NewReader(b.cfg.Body)
	}
	req, _ := http.NewRequestWithContext(ctx, b.cfg.Method, b.cfg.URL, body)
	// Copy pre-canonicalized headers directly (avoids CanonicalHeaderKey overhead per request)
	for k, v := range b.cfg.Headers {
		req.Header[k] = v
	}
	return req
}

func drainResponse(resp *http.Response) {
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

func (b *Blaster) worker(ctx context.Context, wg *sync.WaitGroup) {
	defer wg.Done()
	for ctx.Err() == nil {
		req := b.newRequest(ctx)
		b.stats.sent.Add(1)
		resp, err := b.client.Do(req)
		if err != nil {
			b.stats.fail.Add(1)
			continue
		}
		b.stats.success.Add(1)
		// Drain response asynchronously — worker doesn't block on response body.
		// This is what keeps RPS high: the stream is freed as soon as headers arrive.
		go drainResponse(resp)
	}
}

func (b *Blaster) warmup(conns int) {
	fmt.Print("\033[33m[*] Warming up connections...\033[0m\r")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	sem := make(chan struct{}, conns)
	for i := 0; i < conns; i++ {
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer func() { <-sem; wg.Done() }()
			req := b.newRequest(ctx)
			resp, err := b.client.Do(req)
			if err != nil {
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}()
	}
	wg.Wait()

	// Reset stats — warmup sends don't count
	b.stats.sent.Store(0)
	b.stats.success.Store(0)
	b.stats.fail.Store(0)
	fmt.Print("\033[2K") // clear line
}

func (b *Blaster) Run() {
	ctx, cancel := context.WithTimeout(context.Background(), b.cfg.Duration)
	defer cancel()

	// Graceful shutdown on CTRL+C
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { <-sig; cancel() }()

	proto := "HTTP/2"
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

	b.warmup(b.cfg.Conns)

	// Launch fixed goroutine pool
	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < b.cfg.Workers; i++ {
		wg.Add(1)
		go b.worker(ctx, &wg)
	}

	// Live stats ticker
	ticker := time.NewTicker(time.Second)
	go func() {
		var prevSent int64
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case t := <-ticker.C:
				elapsed := t.Sub(start)
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

	urlFlag := flag.String("url", "", "Target URL (required)")
	workersFlag := flag.Int("workers", 1000, "Number of goroutine workers")
	connsFlag := flag.Int("conns", 50, "Max connections per host")
	durationFlag := flag.Duration("duration", 30*time.Second, "Test duration (e.g. 30s, 1m, 5m)")
	methodFlag := flag.String("method", "GET", "HTTP method")
	bodyFlag := flag.String("body", "", "Request body (for POST/PUT)")
	headersFlag := flag.String("headers", "", "Extra headers, comma-separated: \"Key:Value,Key2:Value2\"")
	skipVerifyFlag := flag.Bool("skip-verify", true, "Skip TLS certificate verification")
	http1Flag := flag.Bool("http1", false, "Force HTTP/1.1 instead of HTTP/2")
	flag.Parse()

	if *urlFlag == "" {
		fmt.Fprintln(os.Stderr, "Error: -url is required")
		flag.Usage()
		os.Exit(1)
	}

	// Pre-canonicalize headers to avoid per-request overhead
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

	cfg := &Config{
		URL:        *urlFlag,
		Workers:    *workersFlag,
		Conns:      *connsFlag,
		Duration:   *durationFlag,
		Method:     strings.ToUpper(*methodFlag),
		Body:       []byte(*bodyFlag),
		Headers:    headers,
		SkipVerify: *skipVerifyFlag,
		ForceHTTP1: *http1Flag,
	}

	NewBlaster(cfg).Run()
}
