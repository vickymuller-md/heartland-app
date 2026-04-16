export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-red-600">
        Authentication Error
      </h1>
      <p className="text-sm text-gray-700">
        {error ?? "An unknown error occurred."}
      </p>
      <a href="/login" className="text-sm text-blue-600 hover:underline">
        Back to Login
      </a>
    </div>
  );
}
