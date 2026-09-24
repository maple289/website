import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ProfileNameFields } from './ProfileNameFields';

export function ProfileNameSettings({ userId }: { userId: string }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await supabase.from('profiles').select('first_name, last_name').eq('id', userId).single();
        if (cancelled) return;
        if (error) throw error;
        setFirstName(data.first_name ?? '');
        setLastName(data.last_name ?? '');
        setLoaded(true);
      } catch {
        if (!cancelled) setError('Could not load your profile. Please reload to try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!loaded || saving) return;
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const { error } = await supabase.rpc('update_profile_names', {
        p_first_name: firstName.trim() || null, p_last_name: lastName.trim() || null,
      });
      if (error) throw error;
      setFirstName(firstName.trim());
      setLastName(lastName.trim());
      setSuccess(true);
    } catch {
      setError('Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mb-6 rounded-2xl border border-[#272727] bg-[#161616] p-5">
      <h3 className="mb-2 text-sm font-semibold">Profile</h3>
      <p className="mb-5 text-sm text-[#999]">Names are optional. Clear either field to remove it.</p>
      <ProfileNameFields firstName={firstName} lastName={lastName} disabled={loading || saving || !loaded}
        onFirstNameChange={(value) => { setFirstName(value); setSuccess(false); }}
        onLastNameChange={(value) => { setLastName(value); setSuccess(false); }} />
      {error && <p role="alert" className="mb-4 text-sm text-[#ff8a90]">{error}</p>}
      {success && <p role="status" className="mb-4 text-sm text-emerald-400">Profile saved.</p>}
      <button type="submit" disabled={loading || saving || !loaded}
        className="h-11 rounded-xl bg-[#ff3d46] px-5 text-sm font-semibold text-white transition hover:bg-[#ff5962] disabled:opacity-50">
        {loading ? 'Loading…' : saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
