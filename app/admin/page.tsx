import Link from 'next/link'

export default function AdminPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
      <ul className="list-disc pl-5">
        <li>
          <Link href="/admin">Dashboard</Link>
        </li>
        <li>
          <Link href="/admin/challenges">Challenges admin</Link>
        </li>
        <li>
          <Link href="/admin/users">Users admin</Link>
        </li>
      </ul>
    </div>
  )
}
