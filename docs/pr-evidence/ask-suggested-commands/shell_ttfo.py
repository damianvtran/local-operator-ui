# Time-to-first-output and time-to-quiet for an interactive shell on a PTY,
# spawned the way the console host does (no args, interactive because stdin is a tty).
import os, pty, sys, time, select, statistics, signal
def one(shell):
    t0=time.monotonic(); pid, fd = pty.fork()
    if pid==0:
        os.environ['TERM']='xterm-256color'
        os.execv(shell,[shell])
    first=None; last=None
    while True:
        r,_,_=select.select([fd],[],[],1.0 if first else 5.0)
        if not r: break
        try: data=os.read(fd,4096)
        except OSError: break
        now=time.monotonic()
        if first is None: first=now
        last=now
    os.kill(pid,signal.SIGKILL); os.waitpid(pid,0); os.close(fd)
    return (first-t0)*1000, (last-t0)*1000
shell=sys.argv[1]; n=int(sys.argv[2])
rows=[one(shell) for _ in range(n)]
f=[a for a,_ in rows]; q=[b for _,b in rows]
print(f"{shell} n={n} first_output_ms median={statistics.median(f):.1f} max={max(f):.1f} min={min(f):.1f} | settle_ms median={statistics.median(q):.1f} max={max(q):.1f} | first->settle max={max(b-a for a,b in rows):.1f}")
