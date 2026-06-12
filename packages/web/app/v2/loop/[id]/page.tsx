import { LoopWorkspaceV2 } from '@/components/LoopWorkspaceV2';

export default async function LoopV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LoopWorkspaceV2 loopId={id} />;
}
