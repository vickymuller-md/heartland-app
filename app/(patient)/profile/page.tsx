import { User } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { StateField } from './_components/state-field';

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentState: string | undefined;

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('state')
      .eq('id', user.id)
      .single();

    currentState = profile?.state ?? undefined;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">
        Profile
      </h1>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <User className="h-6 w-6 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">
            Personal Information
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="state"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              State
            </label>
            <StateField defaultValue={currentState} />
            <p className="mt-1 text-xs text-gray-500">
              Your US state helps your care team understand regional resources.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
