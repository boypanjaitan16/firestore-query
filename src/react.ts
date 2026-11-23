import {
	type QueryClient,
	type UseMutationOptions,
	type UseMutationResult,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	type AggregateSpec,
	type AggregateSpecData,
	addDoc,
	type CollectionReference,
	type DocumentData,
	type DocumentReference,
	deleteDoc,
	type SetOptions,
	setDoc,
	type UpdateData,
	updateDoc,
	type WithFieldValue,
} from "firebase/firestore";
import type { FirestoreQueryErrorType } from "./errors";
import {
	invalidateForWrites,
	type WriteKind,
	type WriteTarget,
} from "./invalidation";
import {
	type FirestoreAggregateArgs,
	type FirestoreInfiniteQueryArgs,
	type FirestoreQueryArgs,
	type FirestoreReadOptions,
	firestoreAggregateOptions,
	firestoreDocOptions,
	firestoreInfiniteQueryOptions,
	firestoreQueryOptions,
} from "./options";

/** One document; `null` disables the query. */
export function useFirestoreDoc<
	T,
	TData = T | null,
	D extends DocumentData = DocumentData,
>(
	ref: DocumentReference<T, D> | null,
	options?: FirestoreReadOptions<T | null, TData>,
) {
	return useQuery(firestoreDocOptions(ref, options));
}

/** A Firestore query; `null` disables it. */
export function useFirestoreQuery<
	T,
	TData = T[],
	D extends DocumentData = DocumentData,
>(args: FirestoreQueryArgs<T, TData, D>) {
	return useQuery(firestoreQueryOptions(args));
}

/** A one-shot paginated query; see `firestoreInfiniteQueryOptions`. */
export function useFirestoreInfiniteQuery<
	T,
	D extends DocumentData = DocumentData,
>(args: FirestoreInfiniteQueryArgs<T, D>) {
	return useInfiniteQuery(firestoreInfiniteQueryOptions(args));
}

/** A one-shot `count`/`sum`/`average` query. */
export function useFirestoreAggregate<
	S extends AggregateSpec,
	T,
	TData = AggregateSpecData<S>,
	D extends DocumentData = DocumentData,
>(args: FirestoreAggregateArgs<S, T, TData, D>) {
	return useQuery(firestoreAggregateOptions(args));
}

export type FirestoreMutationOptions<TResult, TVariables> = Omit<
	UseMutationOptions<TResult, FirestoreQueryErrorType, TVariables>,
	"mutationFn"
> & {
	/** Set `false` to skip the built-in cache invalidation. */
	invalidate?: boolean;
};

function useWriteMutation<TResult, TVariables>(
	mutationFn: (variables: TVariables) => Promise<TResult>,
	targets: (variables: TVariables, result: TResult) => readonly WriteTarget[],
	kind: WriteKind,
	options: FirestoreMutationOptions<TResult, TVariables> = {},
): UseMutationResult<TResult, FirestoreQueryErrorType, TVariables> {
	const client: QueryClient = useQueryClient();
	const { invalidate = true, onSuccess, ...rest } = options;
	return useMutation({
		// Firestore queues offline writes and resolves them once the server
		// confirms, so TanStack must not pause the mutation itself.
		networkMode: "always",
		...rest,
		mutationFn,
		onSuccess: (...args) => {
			const [result, variables] = args;
			if (invalidate)
				invalidateForWrites(client, targets(variables, result), kind);
			return onSuccess?.(...args);
		},
	});
}

export type SetDocVariables<T, D extends DocumentData> = {
	ref: DocumentReference<T, D>;
	data: WithFieldValue<T>;
	options?: SetOptions;
};

export function useSetDoc<
	T = DocumentData,
	D extends DocumentData = DocumentData,
>(options?: FirestoreMutationOptions<void, SetDocVariables<T, D>>) {
	return useWriteMutation(
		({ ref, data, options: setOptions }: SetDocVariables<T, D>) =>
			setOptions ? setDoc(ref, data, setOptions) : setDoc(ref, data),
		({ ref }) => [ref as WriteTarget],
		"set",
		options,
	);
}

export type UpdateDocVariables<T, D extends DocumentData> = {
	ref: DocumentReference<T, D>;
	data: UpdateData<D>;
};

export function useUpdateDoc<
	T = DocumentData,
	D extends DocumentData = DocumentData,
>(options?: FirestoreMutationOptions<void, UpdateDocVariables<T, D>>) {
	return useWriteMutation(
		({ ref, data }: UpdateDocVariables<T, D>) => updateDoc(ref, data),
		({ ref }) => [ref as WriteTarget],
		"update",
		options,
	);
}

export type DeleteDocVariables<T, D extends DocumentData> = {
	ref: DocumentReference<T, D>;
};

export function useDeleteDoc<
	T = DocumentData,
	D extends DocumentData = DocumentData,
>(options?: FirestoreMutationOptions<void, DeleteDocVariables<T, D>>) {
	return useWriteMutation(
		({ ref }: DeleteDocVariables<T, D>) => deleteDoc(ref),
		({ ref }) => [ref as WriteTarget],
		"delete",
		options,
	);
}

export type AddDocVariables<T, D extends DocumentData> = {
	ref: CollectionReference<T, D>;
	data: WithFieldValue<T>;
};

/** Resolves with the new document's reference. */
export function useAddDoc<
	T = DocumentData,
	D extends DocumentData = DocumentData,
>(
	options?: FirestoreMutationOptions<
		DocumentReference<T, D>,
		AddDocVariables<T, D>
	>,
) {
	return useWriteMutation(
		({ ref, data }: AddDocVariables<T, D>) => addDoc(ref, data),
		({ ref }, created) => [ref as WriteTarget, created as WriteTarget],
		"add",
		options,
	);
}

export type FirestoreWriteOptions<TResult, TVariables> =
	FirestoreMutationOptions<TResult, TVariables> & {
		mutationFn: (variables: TVariables) => Promise<TResult>;
		/**
		 * Every document or collection the mutation writes. Required, so a
		 * forgotten target is a type error rather than a stale cache; return
		 * `[]` when nothing should be invalidated.
		 */
		touches: (variables: TVariables, result: TResult) => readonly WriteTarget[];
	};

/** Any write (batch, transaction, several calls) with declared targets. */
export function useFirestoreMutation<TResult, TVariables>({
	mutationFn,
	touches,
	...options
}: FirestoreWriteOptions<TResult, TVariables>) {
	return useWriteMutation(mutationFn, touches, "touch", options);
}
