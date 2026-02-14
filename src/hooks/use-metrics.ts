import { useState, useEffect, useRef } from "react";
import { cpus, freemem, totalmem } from "node:os";
import { exec } from "node:child_process";

export interface SystemMetrics {
  cpuPercent: number;
  cpuHistory: number[];
  memUsedGB: number;
  memTotalGB: number;
  memPercent: number;
  netUp: number;  // KB/s
  netDown: number;
  tick: number;
}

const HISTORY_LEN = 8;
const SAMPLE_MS = 3000;      // CPU/MEM sample every 3s
const NET_EVERY_N = 2;       // Network only every 2nd sample (6s)

// Read network bytes async (macOS only for now)
function readNetBytesAsync(): Promise<{ rx: number; tx: number }> {
  return new Promise((resolve) => {
    exec("netstat -ib", { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve({ rx: 0, tx: 0 });
        return;
      }
      let totalRx = 0;
      let totalTx = 0;
      for (const line of stdout.split("\n")) {
        if (!/^en\d/.test(line)) continue;
        const cols = line.split(/\s+/);
        if (cols.length >= 10) {
          const ibytes = Number(cols[6]);
          const obytes = Number(cols[9]);
          if (!isNaN(ibytes)) totalRx += ibytes;
          if (!isNaN(obytes)) totalTx += obytes;
        }
      }
      resolve({ rx: totalRx, tx: totalTx });
    });
  });
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
    tick: 0,
  });

  const prevCpuRef = useRef<{ idle: number; total: number } | null>(null);
  const prevNetRef = useRef<{ rx: number; tx: number; time: number } | null>(null);
  const historyRef = useRef<number[]>(new Array(HISTORY_LEN).fill(0));
  const tickRef = useRef(0);
  const cancelledRef = useRef(false);
  const prevNetUp = useRef(0);
  const prevNetDown = useRef(0);

  useEffect(() => {
    cancelledRef.current = false;

    async function loop() {
      while (!cancelledRef.current) {
        // CPU (sync, cheap)
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
        historyRef.current = [...historyRef.current.slice(1), cpuPercent];

        // Memory (sync, cheap)
        const free = freemem();
        const tot = totalmem();
        const used = tot - free;
        const memUsedGB = Math.round((used / 1073741824) * 10) / 10;
        const memTotalGB = Math.round((tot / 1073741824) * 10) / 10;
        const memPercent = Math.round((used / tot) * 100);

        // Network: only poll every Nth sample to reduce child process spawning
        tickRef.current += 1;
        let netUp = prevNetUp.current;
        let netDown = prevNetDown.current;

        if (tickRef.current % NET_EVERY_N === 0) {
          const net = await readNetBytesAsync();
          if (cancelledRef.current) break;
          const prevNet = prevNetRef.current;
          if (prevNet && prevNet.rx > 0) {
            const dt = (Date.now() - prevNet.time) / 1000;
            if (dt > 0) {
              netDown = Math.round(((net.rx - prevNet.rx) / 1024 / dt) * 10) / 10;
              netUp = Math.round(((net.tx - prevNet.tx) / 1024 / dt) * 10) / 10;
            }
          }
          prevNetRef.current = { ...net, time: Date.now() };
          prevNetUp.current = Math.max(0, netUp);
          prevNetDown.current = Math.max(0, netDown);
        }

        if (cancelledRef.current) break;

        setMetrics({
          cpuPercent,
          cpuHistory: [...historyRef.current],
          memUsedGB,
          memTotalGB,
          memPercent,
          netUp: Math.max(0, netUp),
          netDown: Math.max(0, netDown),
          tick: tickRef.current,
        });

        await new Promise((r) => setTimeout(r, SAMPLE_MS));
      }
    }

    loop();
    return () => { cancelledRef.current = true; };
  }, []);

  return metrics;
}
