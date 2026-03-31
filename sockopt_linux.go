//go:build linux

package main

import (
	"net"
	"syscall"

	"golang.org/x/sys/unix"
)

// applySocketOpts sets Linux-specific TCP tuning on a raw TCP connection.
// Must be called on the underlying *net.TCPConn before TLS wrapping.
func applySocketOpts(conn net.Conn) {
	tc, ok := conn.(*net.TCPConn)
	if !ok {
		return
	}
	raw, err := tc.SyscallConn()
	if err != nil {
		return
	}
	raw.Control(func(fd uintptr) {
		// Disable Nagle — send packets immediately, don't wait to batch
		syscall.SetsockoptInt(int(fd), syscall.IPPROTO_TCP, syscall.TCP_NODELAY, 1)

		// Send ACKs immediately — reduces round-trip latency
		unix.SetsockoptInt(int(fd), unix.IPPROTO_TCP, unix.TCP_QUICKACK, 1)

		// 4 MB socket send/receive buffers — prevents kernel-side bottlenecks at high RPS
		syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, 4*1024*1024)
		syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_SNDBUF, 4*1024*1024)

		// Allow fast reuse of ports in TIME_WAIT state
		syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
	})
}
