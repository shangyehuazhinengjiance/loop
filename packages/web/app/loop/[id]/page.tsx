import { ChatRoom } from '@/components/ChatRoom';

export default async function LoopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChatRoom loopId={id} />;
}
