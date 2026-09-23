import { getSupabaseClient } from "../lib/supabase";
import { retryAsync } from "../lib/retry";
import { UpdateProfileInput, updateProfileSchema } from "../validators/user.validators";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { StrKey } from "@stellar/stellar-sdk";

/** 
 * Find a user by wallet address or create a new one if not exists.
 * Used during authentication flow.
 *
 * Retry strategy:
 *   - Initial SELECT: idempotent read → retried on transient errors.
 *   - INSERT: non-idempotent write → NOT auto-retried (maxRetries: 0)
 *     to prevent duplicate-row creation without an idempotency key.
 *   - Conflict re-fetch: idempotent read → retried.
 */
export async function findOrCreateUser(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
  }

  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase();

  try {
    // Idempotent read — safe to retry on transient failures.
    // Supabase builder is wrapped in Promise.resolve() so TypeScript's
    // retryAsync constraint (operation: () => Promise<T>) is satisfied.
    const { data, error } = await retryAsync(
      () => Promise.resolve(
        supabase
          .from("users")
          .select("*")
          .eq("address", normalizedAddress)
          .single()
      ),
      { operationName: "find_user_by_address" },
    );

    if (error && error.code === "PGRST116") {
      // Not found — auto-create.
      // INSERT is NOT retried (maxRetries: 0) because a duplicate call could
      // create two rows. The caller must provide an idempotency mechanism for
      // retries on writes to be safe.
      const { data: created, error: createError } = await retryAsync(
        () => Promise.resolve(
          supabase
            .from("users")
            .insert({ address: normalizedAddress })
            .select()
            .single()
        ),
        { operationName: "create_user", maxRetries: 0 },
      );

      // Another request may have inserted the same address after our initial read.
      if (createError?.code === "23505") {
        // Idempotent re-fetch after race — safe to retry
        const { data: existing, error: existingError } = await retryAsync(
          () => Promise.resolve(
            supabase
              .from("users")
              .select("*")
              .eq("address", normalizedAddress)
              .single()
          ),
          { operationName: "find_user_after_conflict" },
        );

        if (!existingError && existing) {
          return existing;
        }
      }

      if (createError) {
        throw new AppError(ErrorCode.INFRA_ERROR, 'Failed to create user record', 500);
      }
      return created;
    }

    if (error) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'PostgreSQL query failed', 500);
    }

    return data;
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.INFRA_ERROR, 'User service dependency failure', 503);
  }
}

/**
 * Update user profile details.
 *
 * Retry strategy:
 *   UPDATE is not blindly retried (maxRetries: 0) because it is a stateful
 *   write. If the caller needs retry resilience on updates, they should
 *   supply a compare-and-swap mechanism or idempotency key at the call site.
 */
export async function updateUser(address: string, input: UpdateProfileInput) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
  }

  // Validate input schema
  const validation = updateProfileSchema.safeParse(input);
  if (!validation.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid profile data', 400);
  }

  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase();

  try {
    // UPDATE is a non-idempotent write — not auto-retried
    const { data, error } = await retryAsync(
      () => Promise.resolve(
        supabase
          .from("users")
          .update({
            display_name: input.displayName,
            avatar_url: input.avatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("address", normalizedAddress)
          .select()
          .single()
      ),
      { operationName: "update_user_profile", maxRetries: 0 },
    );

    if (error) {
      if (error.code === "PGRST116") {
        throw new AppError(ErrorCode.NOT_FOUND, 'User not found', 404);
      }
      throw new AppError(ErrorCode.INFRA_ERROR, 'Update failed', 500);
    }

    return data;
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.INFRA_ERROR, 'User update failed', 503);
  }
}

/**
 * Get public profile details for any user.
 *
 * Idempotent read — retried on transient failures.
 */
export async function getPublicProfile(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
  }

  const supabase = getSupabaseClient();
  const normalizedAddress = address.toLowerCase();

  try {
    // SELECT is idempotent — safe to retry
    const { data, error } = await retryAsync(
      () => Promise.resolve(
        supabase
          .from("users")
          .select("address, display_name, avatar_url, created_at")
          .eq("address", normalizedAddress)
          .single()
      ),
      { operationName: "get_public_profile" },
    );

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Fetch failed', 500);
    }

    return data;
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.INFRA_ERROR, 'User service dependency failure', 503);
  }
}
