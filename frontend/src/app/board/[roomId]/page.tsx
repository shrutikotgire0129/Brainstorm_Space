import BoardPageContent from "@/components/whiteboard/board-page-content";

export const instant = false;

type BoardPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function BoardPage({ params }: BoardPageProps) {
  const { roomId } = await params;

  return <BoardPageContent roomId={roomId} />;
}
