"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { saveRoomOwnerToken } from "@/lib/room-owner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const features = [
  {
    number: "01",
    title: "Think freely",
    description:
      "Sketch ideas, write thoughts, and let your creativity flow without limits.",
    icon: "✳",
  },
  {
    number: "02",
    title: "Work together",
    description:
      "Bring your team into one shared space and watch ideas come to life.",
    icon: "↗",
  },
  {
    number: "03",
    title: "Make ideas happen",
    description:
      "Turn scattered thoughts into clear plans your entire team can understand.",
    icon: "◇",
  },
];

function WhiteboardPreview() {
  return (
    <div className="preview-window">
      <div className="preview-topbar">
        <div className="preview-brand">
          <span className="brand-mark small-mark">B</span>
          <span>Untitled brainstorm</span>
        </div>
        <div className="preview-avatars">
          <span className="avatar avatar-one">S</span>
          <span className="avatar avatar-two">A</span>
          <span className="avatar avatar-three">R</span>
          <span className="invite-pill">+ Invite</span>
        </div>
      </div>

      <div className="preview-canvas">
        <div className="canvas-grid" />

        <div className="canvas-toolbar">
          <span className="tool active-tool">↖</span>
          <span className="tool">✎</span>
          <span className="tool">T</span>
          <span className="tool">▧</span>
          <span className="tool">⌑</span>
        </div>

        <div className="brainstorm-heading">
          <span className="heading-label">TEAM WORKSHOP</span>
          <h3>Big ideas start here.</h3>
          <p>Our next big thing</p>
        </div>

        <div className="sticky sticky-yellow">
          <span className="sticky-pin">✳</span>
          <strong>Think differently</strong>
          <p>What if we tried something completely new?</p>
          <span className="sticky-author">Shruti</span>
        </div>

        <div className="sticky sticky-pink">
          <span className="sticky-pin">✳</span>
          <strong>Make it simple</strong>
          <p>Less complexity. More impact.</p>
          <span className="sticky-author">Alex</span>
        </div>

        <div className="sticky sticky-purple">
          <span className="sticky-pin">✳</span>
          <strong>Build together</strong>
          <p>Great ideas come from great teams.</p>
          <span className="sticky-author">Riya</span>
        </div>

        <div className="preview-cursor cursor-one">
          <span className="cursor-pointer">↖</span>
          <span className="cursor-label">Alex</span>
        </div>

        <div className="preview-cursor cursor-two">
          <span className="cursor-pointer">↖</span>
          <span className="cursor-label">Riya</span>
        </div>

        <div className="canvas-status">
          <span className="status-dot" />
          Everyone is brainstorming
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();

  const [isCreating, setIsCreating] = useState(false);

  async function createBoard() {
    if (isCreating) return;

    try {
      setIsCreating(true);

      const response = await fetch(`${API_URL}/api/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Untitled Board",
        }),
      });

      const result = await response.json();

      if (
        !response.ok ||
        !result.success ||
        !result.data?.id ||
        typeof result.data.ownerToken !== "string"
      ) {
        throw new Error(result.message || "Failed to create board");
      }

      saveRoomOwnerToken(result.data.id, result.data.ownerToken);

      router.push(`/board/${result.data.id}`);
    } catch (error) {
      console.error("Board creation error:", error);

      alert(
        error instanceof Error
          ? error.message
          : "Unable to create board. Please try again.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="home-page">
      <nav className="navbar">
        <Link href="/" className="brand">
          <span className="brand-mark">B</span>
          <span>
            brainstorm<span className="brand-space">space</span>
          </span>
        </Link>

        <div className="nav-links">
          <Link href="#features">Features</Link>
          <Link href="#how-it-works">How it works</Link>
        </div>

        <button className="nav-cta" onClick={createBoard} disabled={isCreating}>
          Create a board <span>↗</span>
        </button>
      </nav>

      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            YOUR TEAM&apos;S CREATIVE SPACE
          </div>

          <h1>
            Great ideas
            <br />
            don&apos;t happen
            <br />
            <span className="highlight-text">in isolation.</span>
          </h1>

          <p className="hero-description">
            A shared space for your team to think out loud, explore
            possibilities, and turn a little chaos into something brilliant.
          </p>

          <div className="hero-actions">
            <button
              className="primary-button"
              onClick={createBoard}
              disabled={isCreating}
            >
              Start brainstorming
              <span className="button-arrow">↗</span>
            </button>

            <a href="#how-it-works" className="secondary-link">
              See how it works <span>↓</span>
            </a>
          </div>

          <div className="hero-proof">
            <div className="proof-avatars">
              <span className="proof-avatar proof-one">S</span>
              <span className="proof-avatar proof-two">A</span>
              <span className="proof-avatar proof-three">R</span>
            </div>

            <p>
              <strong>One space.</strong> Endless possibilities.
            </p>
          </div>
        </div>

        <div className="hero-visual">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />

          <div className="preview-label">
            <span className="preview-label-dot" />
            YOUR IDEAS, TOGETHER
          </div>

          <WhiteboardPreview />

          <div className="floating-note floating-note-one">
            <span>✳</span> Think bigger
          </div>

          <div className="floating-note floating-note-two">
            <span>↗</span> Create together
          </div>
        </div>
      </section>

      <section className="features-section" id="features">
        <div className="section-heading">
          <span className="section-eyebrow">A BETTER WAY TO BRAINSTORM</span>
          <h2>
            Space for every
            <span> brilliant thought.</span>
          </h2>
          <p>From the first spark of an idea to your next big breakthrough.</p>
        </div>

        <div className="feature-grid">
          {features.map((feature) => (
            <article className="feature-card" key={feature.number}>
              <div className="feature-card-top">
                <span className="feature-number">{feature.number}</span>
                <span className="feature-icon">{feature.icon}</span>
              </div>

              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bottom-cta" id="how-it-works">
        <div>
          <span className="section-eyebrow">YOUR NEXT IDEA STARTS HERE</span>
          <h2>Bring your team together.</h2>
          <p>
            Create a board, invite your team, and start building something
            great.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={createBoard}
          disabled={isCreating}
        >
          Create your board <span className="button-arrow">↗</span>
        </button>
      </section>

      <footer className="footer">
        <Link href="/" className="brand footer-brand">
          <span className="brand-mark">B</span>
          <span>
            brainstorm<span className="brand-space">space</span>
          </span>
        </Link>

        <p>Made for ideas that bring people together.</p>

        <span className="footer-copyright">© 2026 Brainstorm Space</span>
      </footer>
    </main>
  );
}
