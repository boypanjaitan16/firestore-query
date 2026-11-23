import type { FirestoreError } from "firebase/firestore";

export type FirestoreQueryErrorCode =
	/** The document an infinite query continues after no longer exists. */
	| "cursor-missing"
	/** A realtime query ran on a client without `attachFirestoreListeners`. */
	| "listeners-not-attached";

/** An error raised by this package rather than by the Firestore SDK. */
export class FirestoreQueryError extends Error {
	readonly code: FirestoreQueryErrorCode;

	constructor(code: FirestoreQueryErrorCode, message: string) {
		super(message);
		this.name = "FirestoreQueryError";
		this.code = code;
	}
}

export function isFirestoreQueryError(
	error: unknown,
): error is FirestoreQueryError {
	return error instanceof FirestoreQueryError;
}

/** The `TError` of every query and mutation in this package. */
export type FirestoreQueryErrorType = FirestoreError | FirestoreQueryError;
