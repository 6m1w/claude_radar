import { useState, useEffect, useRef } from "react";
import { cpus, freemem, totalmem } from "node:os";
import { execSync } from "node:child_process";

export interface SystemMetrics {
  cpuPercent: number;
  cpuHistory: number[];
  memUsedGB: number;
  memTotalGB: number;
  memPercent: number;
  netUp: number;  // KB/s
  netDown: number;
}

const HISTORY_LEN = 8;

// Read network bytes (macOS only for now)
function readNetBytes(): { rx: number; tx: number } {
  try {
    const out = execSync("netstat -ib", { encoding: "utf-8", timeout: 500 });
    const lines = out.split("\n");
    let totalRx = 0;
    let totalTx = 0;
    for (const line of lines) {
      // Match en0/en1 lines with numeric data
      if (!/^en\d/.test(line)) continue;
      const cols = line.split(/\s+/);
      // Columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes
      if (cols.length >= 10) {
        const ibytes = Number(cols[6]);
        const obytes = Number(cols[9]);
        if (!isNaN(ibytes)) totalRx += ibytes;
        if (!isNaN(obytes)) totalTx += obytes;
      }
    }
    return { rx: totalRx, tx: totalTx };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

export function useMetrics(): SystemMetrics {
  const [metrics, setMetrics] = useState<SystemMetrics>({
    cpuPercent: 0,
    cpuHistory: new Array(HISTORY_LEN).fill(0),
    memUsedGB: 0,
    memTotalGB: 0,
    memPercent: 0,
    netUp: 0,
    netDown: 0,
  });

  const prevCpuRef = useRef<{ idle: number; total: number } | null>(null);
  const prevNetRef = useRef<{ rx: number; tx: number; time: number } | null>(null);
  const historyRef = useRef<number[]>(new Array(HISTORY_LEN).fill(0));

  useEffect(() => {
    function sample() {
      // CPU: average across all cores
      const cores = cpus();
      let idle = 0;
      let total = 0;
      for (const core of cores) {
        idle += core.times.idle;
        total += core.times.user + core.times.nice + core.times.sys + core.times.irq + core.times.idle;
      }

      let cpuPercent = 0;
      const prev = prevCpuRef.current;
      if (prev) {
        const dIdle = idle - prev.idle;
        const dTotal = total - prev.total;
        cpuPercent = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0;
      }
      prevCpuRef.current = { idle, total };

      // Update history ring
      historyRef.current = [...historyRef.current.slice(1), cpuPercent];

      // Memory
      const free = freemem();
      const tot = totalmem();
      const used = tot - free;
      const memUsedGB = Math.round((used / 1073741824) * 10) / 10;
      const memTotalGB = Math.round((tot / 1073741824) * 10) / 10;
      const memPercent = Math.round((used / tot) * 100);

      // Network
      let netUp = 0;
      let netDown = 0;
      const net = readNetBytes();
      const prevNet = prevNetRef.current;
      if (prevNet && prevNet.rx > 0) {
        const dt = (Date.now() - prevNet.time) / 1000;
        if (dt > 0) {
          netDown = Math.round(((net.rx - prevNet.rx) / 1024 / dt) * 10) / 10;
          netUp = Math.round(((net.tx - prevNet.tx) / 1024 / dt) * 10) / 10;
        }
      }
      prevNetRef.current = { ...net, time: Date.now() };

      setMetrics({
        cpuPercent,
        cpuHistory: [...historyRef.current],
        memUsedGB,
        memTotalGB,
        memPercent,
        netUp: Math.max(0, netUp),
        netDown: Math.max(0, netDown),
      });
    }

    sample(); // initial
    const timer = setInterval(sample, 1000);
    return () => clearInterval(timer);
  }, []);

  return metrics;
}
