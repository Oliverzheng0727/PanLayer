"use client";

import { ArrowUpRight, Layers3, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const SPOTLIGHT_R = 260;
const navigation = ["今日复盘", "盘前早参", "市场温度", "连板梯队", "行业 ETF"];

export function Hero() {
  const [menuOpen, setMenuOpen] = useState(false);
  const revealRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: -999, y: -999 });
  const smooth = useRef({ x: -999, y: -999 });

  useEffect(() => {
    let raf = 0;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const move = (event: MouseEvent) => { mouse.current = { x: event.clientX, y: event.clientY }; };
    if (finePointer) window.addEventListener("mousemove", move, { passive: true });

    const frame = (now: number) => {
      const layer = revealRef.current;
      if (layer) {
        if (!finePointer) {
          mouse.current.x = window.innerWidth * (0.5 + (reduceMotion ? 0 : Math.sin(now / 2400) * 0.14));
          mouse.current.y = window.innerHeight * (0.55 + (reduceMotion ? 0 : Math.cos(now / 3100) * 0.08));
        }
        if (smooth.current.x < -900) smooth.current = { ...mouse.current };
        smooth.current.x += (mouse.current.x - smooth.current.x) * 0.1;
        smooth.current.y += (mouse.current.y - smooth.current.y) * 0.1;
        const { x, y } = smooth.current;
        const mask = `radial-gradient(circle ${SPOTLIGHT_R}px at ${x}px ${y}px, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 40%, rgba(0,0,0,.75) 60%, rgba(0,0,0,.4) 75%, rgba(0,0,0,.12) 88%, transparent 100%)`;
        layer.style.maskImage = mask;
        layer.style.webkitMaskImage = mask;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      window.removeEventListener("mousemove", move);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="min-h-screen bg-black tracking-[-0.02em]">
      <section className="hero-shell relative h-screen w-full overflow-hidden bg-black" style={{ height: "100dvh" }}>
        <div className="hero-image hero-image-base hero-zoom absolute inset-0 z-10" />
        <div ref={revealRef} className="hero-image hero-image-reveal absolute inset-0 z-30 pointer-events-none" />
        <div className="hero-vignette absolute inset-0 z-40 pointer-events-none" />

        <nav className="fixed inset-x-0 top-0 z-[100] flex items-center justify-between p-4 sm:p-5">
          <Link href="/" className="flex items-center gap-2.5 text-white" aria-label="盘层首页">
            <span className="grid size-8 place-items-center rounded-full border border-white/25 bg-white/10 backdrop-blur-md"><Layers3 size={17} /></span>
            <span className="font-display text-2xl italic">PanLayer</span>
          </Link>

          <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black/20 p-2 backdrop-blur-xl md:flex">
            {navigation.map((item, index) => (
              <Link key={item} href={`/dashboard#${index === 0 ? "overview" : ["brief", "breadth", "ladder", "etfs"][index - 1]}`} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${index === 0 ? "bg-white text-neutral-950" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>{item}</Link>
            ))}
          </div>

          <Link href="/dashboard" className="hidden rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-100 md:flex">进入复盘</Link>
          <button type="button" onClick={() => setMenuOpen((value) => !value)} className="grid size-10 place-items-center rounded-full border border-white/20 bg-black/25 text-white backdrop-blur-xl md:hidden" aria-label={menuOpen ? "关闭菜单" : "打开菜单"}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
          {menuOpen && (
            <div className="absolute left-4 right-4 top-16 rounded-3xl border border-white/15 bg-black/80 p-4 shadow-2xl backdrop-blur-2xl md:hidden">
              {navigation.map((item, index) => <Link key={item} onClick={() => setMenuOpen(false)} href={`/dashboard#${index === 0 ? "overview" : ["brief", "breadth", "ladder", "etfs"][index - 1]}`} className="block rounded-2xl px-4 py-3 text-sm text-white/80 hover:bg-white/10">{item}</Link>)}
            </div>
          )}
        </nav>

        <div className="pointer-events-none absolute inset-x-0 top-[14%] z-50 flex flex-col items-center px-5 text-center text-white">
          <p className="hero-anim hero-fade mb-5 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/60" style={{ animationDelay: "0.1s" }}>PanLayer · 盘层</p>
          <h1 className="leading-[0.9]">
            <span className="font-display hero-anim hero-reveal block text-5xl font-normal italic tracking-[-0.05em] sm:text-7xl md:text-8xl lg:text-[7.4rem]" style={{ animationDelay: "0.25s" }}>Read beneath</span>
            <span className="hero-anim hero-reveal -mt-1 block text-5xl font-normal tracking-[-0.08em] sm:text-7xl md:text-8xl lg:text-[7.4rem]" style={{ animationDelay: "0.42s" }}>the market move</span>
          </h1>
          <p className="hero-anim hero-fade mt-7 text-sm tracking-[0.12em] text-white/68 sm:text-base" style={{ animationDelay: "0.62s" }}>市场有迹，情绪有层</p>
        </div>

        <div className="hero-anim hero-fade absolute bottom-14 left-10 z-50 hidden max-w-[270px] sm:block md:left-14" style={{ animationDelay: "0.72s" }}>
          <p className="text-sm leading-relaxed text-white/70">每一次涨停、每一层板块扩散、每一笔资金变化，都会在市场里留下可以回看的纹理。</p>
        </div>

        <div className="hero-anim hero-fade absolute bottom-10 left-5 right-5 z-50 flex max-w-full flex-col items-start gap-5 sm:bottom-20 sm:left-auto sm:right-10 sm:max-w-[310px] md:right-14" style={{ animationDelay: "0.86s" }}>
          <p className="text-xs leading-relaxed text-white/70 sm:text-sm">把涨跌家数、连板梯队、资金与产业催化沉淀为可回看的每日市场切片。</p>
          <Link href="/dashboard" className="group flex items-center gap-2 rounded-full bg-[#e8702a] px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-[#e8702a]/20 transition hover:scale-[1.03] hover:bg-[#d96424] active:scale-95">进入今日复盘 <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></Link>
        </div>
      </section>
    </main>
  );
}
