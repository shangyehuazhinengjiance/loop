import { redirect } from 'next/navigation';

export default function V1HomePage() {
  redirect('/v2');
}
