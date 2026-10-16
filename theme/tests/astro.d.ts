// Astro's ambient types (`App.Locals`), and `*.astro` modules as the container API takes them: Astro 7 leaves the
// module declaration to its editor tooling, which this package doesn't use.
/// <reference types="astro/client" />
declare module "*.astro" {
	const component: Parameters<import("astro/container").experimental_AstroContainer["renderToString"]>[0];
	export default component;
}
