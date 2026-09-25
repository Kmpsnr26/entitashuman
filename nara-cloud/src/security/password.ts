import * as argon2 from "argon2";

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32
} as const;

const DUMMY_PASSWORD = "NARA-DUMMY-PASSWORD-NOT-VALID-2026";

const dummyHashPromise = argon2.hash(
  DUMMY_PASSWORD,
  ARGON_OPTIONS
);

export async function hashPassword(
  password: string
): Promise<string> {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Password harus 12–256 karakter.");
  }

  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string | null | undefined,
  password: string
): Promise<boolean> {
  try {
    const hash = passwordHash ?? await dummyHashPromise;
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
