export {}

declare module 'gpuix-svelte/test' {
	/** the JSON values a native prop arrives as in the tree, objects included (a `theme`) */
	type NativePropValue =
		string | number | boolean | null | NativePropValue[] | { [key: string]: NativePropValue }

	interface TreeNode {
		/** a native element's own props (an <img>'s `src`), which getTreeJson() carries but TreeNode leaves out */
		customProps?: Record<string, NativePropValue>
	}
}
