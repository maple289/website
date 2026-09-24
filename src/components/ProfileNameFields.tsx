type Props = {
  firstName: string;
  lastName: string;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  disabled?: boolean;
};

export function ProfileNameFields({ firstName, lastName, onFirstNameChange, onLastNameChange, disabled }: Props) {
  return (
    <div className="mb-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      {[
        { label: 'First Name', value: firstName, change: onFirstNameChange, autocomplete: 'given-name' },
        { label: 'Last Name', value: lastName, change: onLastNameChange, autocomplete: 'family-name' },
      ].map((field) => (
        <label key={field.autocomplete} className="min-w-0 text-xs font-semibold text-[#9a9a9a]">
          {field.label} <span className="font-normal">(optional)</span>
          <input type="text" value={field.value} onChange={(e) => field.change(e.target.value)}
            autoComplete={field.autocomplete} maxLength={100} disabled={disabled}
            className="mt-2 h-12 w-full min-w-0 rounded-xl border border-[#3a3a3a] bg-[#121212] px-3 text-base font-normal text-white outline-none transition focus:border-[#4b86ff] disabled:opacity-60" />
        </label>
      ))}
    </div>
  );
}
