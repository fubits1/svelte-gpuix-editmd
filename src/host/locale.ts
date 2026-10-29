/**
 * the environment for a child process that reads or writes text outside ASCII (pbcopy and pbpaste, lsof's file
 * names, osascript's arguments): the app's own, with a UTF-8 locale. they work in the locale's encoding, the C
 * encoding when there is none (man pbcopy; lsof then escapes a name's bytes), and an app started from Finder has no
 * LANG
 */
export function withUtf8Locale(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return { ...environment, LC_ALL: 'en_US.UTF-8' }
}
