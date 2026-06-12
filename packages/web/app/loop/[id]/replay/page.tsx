import { redirect } from 'next/navigation';

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/v2/loop/${id}/replay`);
}
