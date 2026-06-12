import { ChatRoom } from '@/components/ChatRoom';
import { V1DeprecationBanner } from '@/components/V1DeprecationBanner';

export default async function LoopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <V1DeprecationBanner />
      <ChatRoom loopId={id} />
    </>
  );
}
