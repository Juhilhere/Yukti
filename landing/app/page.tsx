import { Hero, Nav } from "@/components/Hero";
import { Flow, Problem } from "@/components/Flow";
import { Trust } from "@/components/Trust";
import { Features } from "@/components/Features";
import { Architecture, Compare } from "@/components/Architecture";
import { Footer, Performance, Roadmap, Roles, Security, Start } from "@/components/Rest";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Flow />
        <Trust />
        <Features />
        <Architecture />
        <Compare />
        <Performance />
        <Roles />
        <Security />
        <Start />
        <Roadmap />
      </main>
      <Footer />
    </>
  );
}
