import GuestJoinPage from "@/components/whiteboard/guest-join-page";

export const instant = false;

type GuestJoinRouteProps = {
  params: Promise<{
    roomId: string;
    token: string;
  }>;
};

export default async function GuestJoinRoute({ params }: GuestJoinRouteProps) {
  const { roomId, token } = await params;

  return <GuestJoinPage roomId={roomId} token={token} />;
}
