import Link from "next/link";
type BoardPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export const instant = false;

export default async function BoardPage({
  params,
}: BoardPageProps) {
  const { roomId } = await params;

  return (
    <main className="room-page">
      <header className="room-header">
        <Link href="/" className="brand">
          <span className="brand-mark">B</span>
          <span>
            brainstorm<span className="brand-space">space</span>
          </span>
        </Link>

        <span className="room-badge">
          <span className="room-dot" />
          New board
        </span>
      </header>

      <section className="room-content">
        <div className="room-icon">✳</div>

        <span className="section-eyebrow">
          YOUR CREATIVE SPACE
        </span>

        <h1>Your board is ready.</h1>

        <p>
          This is your new brainstorming room.
          We&apos;ll build the collaborative canvas here next.
        </p>

        <div className="room-id-card">
          <span>BOARD ROOM ID</span>
          <code>{roomId}</code>
        </div>

        <Link href="/" className="room-back-link">
          ← Back to homepage
        </Link>
      </section>
    </main>
  );
}
