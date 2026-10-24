export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'employee';
  title: string;
  passwordHint: string;
  passwords: string[]; // Supported valid passwords (e.g. Aadhitiya@123, Aadhitiyalahoti@123)
  avatarColor: string;
}

export const SYSTEM_USERS: UserProfile[] = [
  {
    id: 'user_aadhitiya',
    name: 'Aadhitiya Lahoti',
    email: 'aadhitiya@lahotioverseas.com',
    role: 'admin',
    title: 'Director & Head of Trading',
    passwordHint: 'Aadhitiya@123',
    passwords: ['Aadhitiya@123', 'Aadhitiyalahoti@123', 'aadhitiya@123'],
    avatarColor: 'bg-indigo-600 text-white',
  },
  {
    id: 'user_saurabh',
    name: 'Saurabh Lahoti',
    email: 'saurabh@lahotioverseas.com',
    role: 'admin',
    title: 'Managing Director & Admin',
    passwordHint: 'Saurabh@123',
    passwords: ['Saurabh@123', 'Saurabhlahoti@123', 'saurabh@123'],
    avatarColor: 'bg-blue-600 text-white',
  },
  {
    id: 'user_javier',
    name: 'Javier Moreano',
    email: 'javier@lahotioverseas.com',
    role: 'employee',
    title: 'International Trade Specialist',
    passwordHint: 'Javier@123',
    passwords: ['Javier@123', 'Javiermoreano@123', 'javier@123'],
    avatarColor: 'bg-emerald-600 text-white',
  },
  {
    id: 'user_mehadi',
    name: 'Mehadi Hasan',
    email: 'mehadi@lahotioverseas.com',
    role: 'employee',
    title: 'Regional Sales & Operations',
    passwordHint: 'Mehadi@123',
    passwords: ['Mehadi@123', 'Mehedi@123', 'mehadihasan@123', 'mehadi@123'],
    avatarColor: 'bg-teal-600 text-white',
  },
  {
    id: 'user_rashmi',
    name: 'Rashmi Shishivkar',
    email: 'rashmi@lahotioverseas.com',
    role: 'employee',
    title: 'Export Logistics & Costing',
    passwordHint: 'Rashmi@123',
    passwords: ['Rashmi@123', 'Rashmishishivkar@123', 'rashmi@123'],
    avatarColor: 'bg-amber-600 text-white',
  },
  {
    id: 'user_tusshar',
    name: 'Tusshar Manekarr',
    email: 'tusshar@lahotioverseas.com',
    role: 'employee',
    title: 'Yarn Trading Manager',
    passwordHint: 'Tusshar@123',
    passwords: ['Tusshar@123', 'Tushar@123', 'tussharmanekarr@123', 'tusshar@123'],
    avatarColor: 'bg-violet-600 text-white',
  },
  {
    id: 'user_avinash',
    name: 'Avinash',
    email: 'avinash@lahotioverseas.com',
    role: 'employee',
    title: 'Trade Operations Specialist',
    passwordHint: 'Avinash@123',
    passwords: ['Avinash@123', 'avinash@123'],
    avatarColor: 'bg-cyan-600 text-white',
  },
  {
    id: 'user_mahnaz',
    name: 'Mahnaz Kausar Kausar',
    email: 'mahnaz@lahotioverseas.com',
    role: 'employee',
    title: 'Client Relations & Documentation',
    passwordHint: 'Mahnaz@123',
    passwords: ['Mahnaz@123', 'Mahnazkausar@123', 'mahnaz@123'],
    avatarColor: 'bg-rose-600 text-white',
  },
];

export const AUTH_STORAGE_KEY = 'lahoti_costing_auth_user';
export const AUTH_TOKEN_KEY = 'lahoti_costing_auth_token';

// Explicitly wipe out legacy permanent auth key in localStorage so new links always ask for password
try {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
} catch {}

export function getStoredAuthToken(): string | null {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (!token) {
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } else {
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    }
  } catch {}
}

export function getStoredUser(): UserProfile | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user: UserProfile | null): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}

  if (!user) {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } else {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  }
}

export function authenticateUser(emailInput: string, passwordInput: string): { success: boolean; user?: UserProfile; error?: string } {
  const cleanEmail = emailInput.trim().toLowerCase();
  const cleanPassword = passwordInput.trim();

  const foundUser = SYSTEM_USERS.find(u => u.email.toLowerCase() === cleanEmail);

  if (!foundUser) {
    return { success: false, error: 'No account found with this email address.' };
  }

  // Check password against valid passwords
  const isMatch = foundUser.passwords.some(
    p => p === cleanPassword || p.toLowerCase() === cleanPassword.toLowerCase()
  );

  if (!isMatch) {
    return {
      success: false,
      error: `Incorrect password for ${foundUser.name}. Hint: First letter capitalized ending with @123 (e.g. ${foundUser.passwordHint}).`,
    };
  }

  return { success: true, user: foundUser };
}
