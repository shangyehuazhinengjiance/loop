import { LoopReplayV2 } from '@/components/LoopReplayV2';

export default async function LoopReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LoopReplayV2 loopId={id} />;
}
