import { OUTSIDE_EDIT } from './agentEdits.ts'
import { describe, expect, test } from 'vitest'
import { caretThrough, deletionSlot, Document } from './document.ts'

describe('Document', () => {
	test('editing a block replaces exactly its slice; gaps and other blocks keep their bytes', () => {
		const text = '# Title\n\n\n* one\n* two\n\nLast   paragraph.  \n'
		const document = new Document(text)

		document.editBlock(1, '- uno\n- dos')

		expect(document.text).toBe('# Title\n\n\n- uno\n- dos\n\nLast   paragraph.  \n')
		expect(document.blocks.map(({ kind }) => kind)).toEqual(['heading', 'list', 'paragraph'])
	})

	test('ticking a task flips one character and nothing else', () => {
		const document = new Document('- [ ] one\n- [X] two\n')
		const [first, second] = document.blocks[0]!.tasks!

		document.toggleTask(first!.mark)
		expect(document.text).toBe('- [x] one\n- [X] two\n')

		document.toggleTask(second!.mark)
		expect(document.text).toBe('- [x] one\n- [ ] two\n')
		expect(document.blocks[0]!.tasks!.map(({ checked }) => checked)).toEqual([true, false])
	})

	test('dirty means the text differs from the baseline, wherever the edit came from', () => {
		const document = new Document('one\n\ntwo\n')
		expect(document.isDirty).toBe(false)

		document.editBlock(0, 'ONE')
		expect(document.isDirty).toBe(true)

		document.editBlock(0, 'one')
		expect(document.isDirty).toBe(false)

		document.editBlock(1, 'TWO')
		document.markSaved()
		expect(document.isDirty).toBe(false)
		expect(document.baseline).toBe('one\n\nTWO\n')
	})

	test('a disk merge keeps unsaved edits and takes the disk text as the new baseline', () => {
		const document = new Document('# Plan\n\nfirst\n\nsecond\n')
		document.editBlock(1, 'first, edited here')

		document.mergeFromDisk('# Plan\n\nfirst\n\nsecond, edited by an agent\n')

		expect(document.text).toBe('# Plan\n\nfirst, edited here\n\nsecond, edited by an agent\n')
		expect(document.baseline).toBe('# Plan\n\nfirst\n\nsecond, edited by an agent\n')
		expect(document.isDirty).toBe(true)
	})

	test('typing in an edit session splices the field into the document as the user types', () => {
		const document = new Document('# A\n\npara one\n\nlast\n')
		const session = document.openEdit(1)

		expect(session.source).toBe('para one')
		session.update('para one, typed')
		session.update('para one, typed\n\nnew block')

		expect(document.text).toBe('# A\n\npara one, typed\n\nnew block\n\nlast\n')
	})

	test('a disk merge during an edit session lands now; its change to the active block is deferred, not lost', () => {
		const document = new Document('# A\n\npara one\n\nlast\n')
		const session = document.openEdit(1)
		session.update('para one, typed')

		document.mergeFromDisk('# A\n\npara one\nagent line\n\nlast, agent\n')

		expect(document.text).toBe('# A\n\npara one, typed\nagent line\n\nlast, agent\n')
		expect(session.hasDeferredMerge).toBe(true)

		// the field still shows the user's text and keeps typing on top of it
		session.update('para one, typed more')
		expect(document.text).toBe('# A\n\npara one, typed more\nagent line\n\nlast, agent\n')

		session.close()
		expect(document.blocks[1]).toMatchObject({ kind: 'paragraph' })
		expect(document.text.slice(document.blocks[1]!.start, document.blocks[1]!.end)).toBe(
			'para one, typed more\nagent line'
		)
	})

	test('a disk merge that only shifts the active block defers nothing and typing still lands in it', () => {
		const document = new Document('# A\n\npara one\n')
		const session = document.openEdit(1)
		session.update('para one, typed')

		document.mergeFromDisk('# A\n\nnew block from an agent\n\npara one\n')

		expect(session.hasDeferredMerge).toBe(false)
		session.update('para one, typed more')
		expect(document.text).toBe('# A\n\nnew block from an agent\n\npara one, typed more\n')
	})

	test('editing or ticking an earlier block during an edit session keeps typing in the active block', () => {
		const document = new Document('- [ ] task\n\nfirst\n\nactive\n')
		const session = document.openEdit(2)

		document.editBlock(1, 'first, now longer')
		document.toggleTask(document.blocks[0]!.tasks![0]!.mark)
		session.update('active, typed')

		expect(document.text).toBe('- [x] task\n\nfirst, now longer\n\nactive, typed\n')
	})

	test('a disk merge elsewhere does not defer anything even after typing split the active block in two', () => {
		const document = new Document('# A\n\nactive\n\nlast\n')
		const session = document.openEdit(1)
		session.update('active\n\nsplit off')

		document.mergeFromDisk('# A\n\nactive\n\nlast, agent\n')

		expect(session.hasDeferredMerge).toBe(false)
		session.update('active\n\nsplit off, typed')
		expect(document.text).toBe('# A\n\nactive\n\nsplit off, typed\n\nlast, agent\n')
	})

	test('a disk merge reports which blocks it changed or added, by their new index', () => {
		const document = new Document('# A\n\none\n\ntwo\n')

		expect(document.mergeFromDisk('# A\n\none\n\nTWO\n\nthree\n')).toEqual([2, 3])
		expect(document.mergeFromDisk('# A\n\none\n\nTWO\n\nthree\n')).toEqual([])
	})

	/**
	 * editmd marks a Block that kept its kind by the text that changed in it and a new or retyped Block whole
	 * (web/src/changes.ts:28-74, highlights.ts:185-188): the highlight of the first carries those runs
	 */
	test('a disk merge marks a Block that kept its kind by its changed runs, a new or retyped Block whole', () => {
		const document = new Document('# A\n\none two three\n\nlast\n')
		document.mergeFromDisk('## A\n\none TWO three\n\nlast\n\nnew block\n')
		const marked = () =>
			document.highlights.map(({ start, end, runs }) => [
				document.text.slice(start, end),
				runs ?? null
			])

		expect(marked()).toEqual([
			['## A', null],
			['one TWO three', [{ text: 'TWO', index: 0 }]],
			['new block', null]
		])

		// typing in the Block makes its runs stale: it is marked whole from then on
		document.editBlock(1, 'one TWO three, typed')
		expect(marked()[1]).toEqual(['one TWO three, typed', null])
	})

	// editmd's "Deleted by" marker for text taken away inside a block carries that text (highlights.ts:189-219), cut
	// by a character diff as ProseMirror's findDiffStart/findDiffEnd cut it: "one two three" to "one three" is "wo t"
	test('a disk merge that only takes text out of a Block keeps the removed text on its highlight', () => {
		const document = new Document('one two three\n\nlast\n')
		document.mergeFromDisk('one three\n\nlast\n')
		expect(document.highlights.map(({ removed, runs }) => [removed ?? null, runs ?? null])).toEqual(
			[['wo t', null]]
		)
	})

	// 👍 to 👎 on disk came in as two U+FFFD and left the Document dirty, so the autosave wrote them
	test('an emoji changed on disk merges whole and leaves the Document clean', () => {
		const document = new Document('Status: 👍\n\nrest\n')
		document.mergeFromDisk('Status: 👎\n\nrest\n')
		expect([document.text, document.isDirty]).toEqual(['Status: 👎\n\nrest\n', false])
	})

	// editmd drops a highlight whose text is gone (highlights.ts:145-150, 169-170), so the legend no longer counts it
	test('a highlight whose text the user deletes is dropped', () => {
		const claude = { id: 'abc', name: 'Claude · notes' }
		const document = new Document('# A\n\none\n\ntwo\n')
		document.mergeFromDisk('# A\n\none\n\nTWO, by claude\n', claude)
		expect(document.highlights).toHaveLength(1)

		document.editBlock(2, '')

		expect(document.highlights).toEqual([])
	})

	// editmd's highlight tooltip names the agent and the time of the change (web/src/highlights.ts:214-216)
	test('a disk merge stamps its highlights with the time it landed', () => {
		const document = new Document('# A\n\none\n')

		document.mergeFromDisk('# A\n\none, changed\n', null, 1_790_000_000_000)

		expect(document.highlights.map(({ at }) => at)).toEqual([1_790_000_000_000])
	})

	// editmd highlights only the body's changes; the front matter merges as plain text (web/src/editor.ts:221-226)
	test('a disk merge that changes the front matter highlights only the body blocks it changed', () => {
		const claude = { id: 'abc', name: 'Claude · notes' }
		const document = new Document('---\ntitle: A\n---\n\none\n')

		document.mergeFromDisk('---\ntitle: B\n---\n\none, by claude\n', claude)

		expect(document.highlights.map(({ start, end }) => document.text.slice(start, end))).toEqual([
			'one, by claude'
		])
	})

	test('a disk merge credited to an agent highlights the blocks it changed, and the highlight follows later edits', () => {
		const claude = { id: 'abc', name: 'Claude · notes' }
		const document = new Document('# A\n\none\n\ntwo\n')

		document.mergeFromDisk('# A\n\none\n\nTWO, by claude\n', claude)
		const highlighted = () =>
			document.highlights.map(({ author, start, end }) => ({
				author: author.id,
				slice: document.text.slice(start, end)
			}))
		expect(highlighted()).toEqual([{ author: 'abc', slice: 'TWO, by claude' }])

		document.editBlock(1, 'one, now much longer')
		expect(highlighted()).toEqual([{ author: 'abc', slice: 'TWO, by claude' }])

		document.clearHighlights('abc')
		expect(document.highlights).toEqual([])
	})

	// the user's report: typing in an open Block while an outside write removes or adds a Block above it lost the typing
	test('an open Edit session keeps its typing when a disk merge removes or adds a Block above it', () => {
		const run = (theirs: string) => {
			const document = new Document('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
			const session = document.openEdit(1)
			session.update('First paragraph, typed by me.')
			document.mergeFromDisk(theirs)
			// a change at the start of the field, so a session start the merge did not move would show
			session.update('Now: First paragraph, typed by me.')
			session.close()
			return document.text
		}

		expect([
			run('First paragraph.\n\nSecond paragraph.\n'),
			run('# Title\n\nNew paragraph.\n\nFirst paragraph.\n\nSecond paragraph.\n')
		]).toEqual([
			'Now: First paragraph, typed by me.\n\nSecond paragraph.\n',
			'# Title\n\nNew paragraph.\n\nNow: First paragraph, typed by me.\n\nSecond paragraph.\n'
		])
	})

	/**
	 * an outside write that deletes the Block being edited: editmd's rich editor drops the typing with the Block
	 * (measured on its MarkdownEditor), its Source mode glues the typing onto the next Block; the port keeps
	 * the field's text as its own Block where the deleted one was, since losing typing is what the user reported
	 */
	test('an open Block deleted from outside keeps the field’s text as its own Block, and later typing lands in order', () => {
		const run = (start: string, index: number, typed: string, theirs: string) => {
			const document = new Document(start)
			const session = document.openEdit(index)
			session.update(typed)
			document.mergeFromDisk(theirs)
			const afterMerge = [
				document.text,
				session.hasDeferredMerge,
				document.text.slice(session.start, session.end)
			]
			session.update(`${typed}z`)
			session.close()
			return [afterMerge, document.text]
		}

		expect([
			run(
				'# Title\n\nFirst paragraph.\n\nSecond paragraph.\n',
				1,
				'First paragraph.xy',
				'# Title\n\nSecond paragraph.\n'
			),
			run('# Title\n\nLast paragraph.\n', 1, 'Last paragraph.xy', '# Title\n')
		]).toEqual([
			[
				['# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n', false, 'First paragraph.xy'],
				'# Title\n\nFirst paragraph.xyz\n\nSecond paragraph.\n'
			],
			[
				['# Title\n\nLast paragraph.xy\n', false, 'Last paragraph.xy'],
				'# Title\n\nLast paragraph.xyz\n'
			]
		])
	})

	// the view finds the open field's Block by the session's range, which a Disk merge moves
	test('an Edit session tells where its text sits now, after a disk merge moved it', () => {
		const document = new Document('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
		const session = document.openEdit(1)
		session.update('First, typed.')
		const before = [session.start, session.end]
		document.mergeFromDisk('First paragraph.\n\nSecond paragraph.\n')

		expect([
			before,
			[session.start, session.end],
			document.text.slice(session.start, session.end)
		]).toEqual([[9, 22], [0, 13], 'First, typed.'])
	})

	// editmd writes a reference inline once the user removes its definition (web/src/markdown/references.ts:32-60)
	test('the user removing a definition writes its references inline, in the same undo step', () => {
		const source = 'see [docs][d]\n\n[d]: https://x.example\n\nlast\n'
		const removed = (via: 'block' | 'session') => {
			const document = new Document(source)
			if (via === 'block') document.editBlock(1, '')
			else {
				const session = document.openEdit(1)
				session.update('')
				session.close()
			}
			const text = document.text
			document.undo()
			return [text, document.text]
		}

		expect([removed('block'), removed('session')]).toEqual([
			['see [docs](https://x.example)\n\n\n\nlast\n', source],
			['see [docs](https://x.example)\n\n\n\nlast\n', source]
		])
	})

	// a definition an agent changed or removed while the user typed elsewhere had its references
	// written inline with the old URL once the field closed; editmd leaves them, as only the user's own change counts
	test('a definition changed or removed from outside during typing leaves its references as they are', () => {
		const source = 'see [docs][d]\n\ntyping here\n\n[d]: https://x.example/v1\n'
		const typedAround = (theirs: string) => {
			const document = new Document(source)
			const session = document.openEdit(1)
			session.update('typing here, more')
			document.mergeFromDisk(theirs)
			session.update('typing here, more and more')
			session.close()
			return document.text
		}

		expect([
			typedAround('see [docs][d]\n\ntyping here\n\n[d]: https://x.example/v2\n'),
			typedAround('see [docs][d]\n\ntyping here\n')
		]).toEqual([
			'see [docs][d]\n\ntyping here, more and more\n\n[d]: https://x.example/v2\n',
			'see [docs][d]\n\ntyping here, more and more\n'
		])
	})

	// editmd: "Highlights follow edits, undo and merges" (README.md:39)
	test('an agent’s highlight follows the user’s undo and redo of an edit before it', () => {
		const claude = { id: 'abc', name: 'Claude · notes' }
		const document = new Document('# A\n\none\n\ntwo\n')
		document.mergeFromDisk('# A\n\none\n\nTWO, by claude\n', claude)
		const highlighted = () =>
			document.highlights.map(({ start, end }) => document.text.slice(start, end))

		document.editBlock(1, 'one, now much longer')
		document.undo()
		const afterUndo = [document.text, highlighted()]
		document.redo()

		expect([afterUndo, [document.text, highlighted()]]).toEqual([
			['# A\n\none\n\nTWO, by claude\n', ['TWO, by claude']],
			['# A\n\none, now much longer\n\nTWO, by claude\n', ['TWO, by claude']]
		])
	})

	/**
	 * editmd's `changes` (web/src/changes.ts:41-44): the Blocks of a hunk past the ones paired with new Blocks were
	 * removed, and one `deleted` change at the start of the Block after them holds their text, one per line
	 */
	describe('Deletions', () => {
		const claude = { id: 'abc', name: 'Claude · notes' }
		/** each Deletion as its author, time, text and the text right after its offset */
		const marked = (document: Document) =>
			document.deletions.map(({ author, at, text, offset }) => ({
				author: author.id,
				at,
				text,
				before: document.text.slice(offset, offset + 5)
			}))

		test('a disk merge that removes Blocks marks one Deletion before the Block after them, with author, time and text', () => {
			const document = new Document('# A\n\none\n\ntwo\n\nthree\n')

			document.mergeFromDisk('# A\n\nthree\n', claude, 1_790_000_000_000)

			expect(marked(document)).toEqual([
				{ author: 'abc', at: 1_790_000_000_000, text: 'one\ntwo', before: 'three' }
			])
			expect(document.highlights).toEqual([])
		})

		test('a removed Block paired with a new one is a change; only the Blocks past the pairs are a Deletion', () => {
			const document = new Document('# A\n\none\n\ntwo\n\nthree\n')

			document.mergeFromDisk('# A\n\nONE\n\nthree\n', claude, 1)

			expect(document.highlights.map(({ start, end }) => document.text.slice(start, end))).toEqual([
				'ONE'
			])
			expect(marked(document)).toEqual([{ author: 'abc', at: 1, text: 'two', before: 'three' }])
		})

		test('a removed last Block is marked at the end of the text; removed front matter is not marked', () => {
			const document = new Document('---\nt: a\n---\n\n# A\n\none\n\ntwo\n')

			document.mergeFromDisk('# A\n\none\n', null, 2)

			expect(document.deletions.map(({ author, text, offset }) => [author, text, offset])).toEqual([
				[OUTSIDE_EDIT, 'two', document.text.length]
			])
		})

		test('a Deletion keeps its place through later edits and merges, and clears with its Agent or a reset', () => {
			const document = new Document('# A\n\none\n\ntwo\n\nthree\n')
			document.mergeFromDisk('# A\n\none\n\nthree\n', claude, 3)

			document.editBlock(1, 'one, now much longer')
			document.mergeFromDisk('# A, agent\n\none, now much longer\n\nthree\n', claude, 4)
			expect(marked(document)).toEqual([{ author: 'abc', at: 3, text: 'two', before: 'three' }])

			document.clearHighlights('def')
			expect(document.deletions).toHaveLength(1)
			document.clearHighlights('abc')
			expect(document.deletions).toEqual([])

			document.mergeFromDisk('# A, agent\n\nthree\n', claude, 5)
			expect(document.deletions).toHaveLength(1)
			document.reset('# A\n')
			expect(document.deletions).toEqual([])
		})

		test('typing in an Edit session before a Deletion keeps it before the Block after the removed ones', () => {
			const document = new Document('# A\n\none\n\ntwo\n\nthree\n')
			document.mergeFromDisk('# A\n\none\n\nthree\n', claude, 6)

			document.openEdit(1).update('one, typed')

			expect(marked(document)).toEqual([{ author: 'abc', at: 6, text: 'two', before: 'three' }])
		})

		test('a Deletion paints above the first Block that ends past its offset, or after the last Block', () => {
			const blocks = [
				{ start: 0, end: 3 },
				{ start: 5, end: 8 }
			]

			expect([0, 3, 4, 5, 7, 8, 9].map((offset) => deletionSlot(blocks, offset))).toEqual([
				0, 1, 1, 1, 1, 2, 2
			])
		})
	})

	test('inserting a block after another adds it with a blank line between, everything else untouched', () => {
		const document = new Document('# A\n\npara\n\nlast\n')

		document.insertBlockAfter(1, '---')

		expect(document.text).toBe('# A\n\npara\n\n---\n\nlast\n')
		expect(document.blocks.map(({ kind }) => kind)).toEqual([
			'heading',
			'paragraph',
			'thematicBreak',
			'paragraph'
		])
	})

	test('inserting after the last block keeps the final newline', () => {
		const document = new Document('para\n')
		document.insertBlockAfter(0, '| a |\n| - |\n|   |')

		expect(document.text).toBe('para\n\n| a |\n| - |\n|   |\n')
	})

	test('typing in a session splices only what changed, so highlights inside it stay on their text', () => {
		const claude = { id: 'abc', name: 'Claude · notes' }
		const document = new Document('# A\n\none\n\ntwo\n')
		document.mergeFromDisk('# A\n\none\n\nTWO, by claude\n', claude)

		document.openSourceEdit().update('# A, retitled\n\none\n\nTWO, by claude\n\nnew\n')

		expect(document.text).toBe('# A, retitled\n\none\n\nTWO, by claude\n\nnew\n')
		expect(document.highlights.map(({ start, end }) => document.text.slice(start, end))).toEqual([
			'TWO, by claude'
		])
		expect(document.isDirty).toBe(true)
	})

	// the user's bug: an outside change to the Block being typed in did not show in its field, as editmd shows it live
	test('an outside change to the open Block is handed to its field with the typing kept, and typing goes on after', () => {
		const document = new Document('# Title\n\nFirst paragraph.\n')
		const session = document.openEdit(1)
		session.update('First paragraph, mine.')
		document.mergeFromDisk('# Title\n\nFirst, theirs, paragraph.\n')
		const handed = session.takeOutsideChange()
		const after = session.takeOutsideChange()
		session.update(`${handed!.text} More.`)

		expect([
			handed!.text,
			// the edits from what the field showed to the merged text, to move the caret through
			handed!.edits.length > 0,
			after,
			session.hasDeferredMerge,
			document.text
		]).toEqual([
			'First, theirs, paragraph, mine.',
			true,
			null,
			false,
			'# Title\n\nFirst, theirs, paragraph, mine. More.\n'
		])
	})

	// editmd's serializer ends a document it writes with a newline; a new document typed in the port had none
	test('a new document gets its final newline when a field closes, and an existing file without one is left as it is', () => {
		// an empty Document's first field, as the window's "Start writing…" opens it
		const fresh = new Document('')
		const typed = fresh.openSourceEdit()
		typed.update('Hello there')
		typed.close()
		const existing = new Document('No newline')
		const field = existing.openEdit(0)
		field.update('No newline, edited')
		field.close()
		expect([fresh.text, existing.text]).toEqual(['Hello there\n', 'No newline, edited'])
	})

	// a file with no final newline (as a new document saves), the user typing in its last Block, an
	// agent appending a section: the section joined the user's open field as raw markdown
	test('a section appended right after the open Block stays outside its field, as new Blocks', () => {
		const document = new Document('Hello there')
		const session = document.openEdit(0)
		session.update('Hello there, more')
		document.mergeFromDisk('Hello there\n\n## Agent section\n\nAgent text')
		expect([
			document.text,
			document.text.slice(session.start, session.end),
			session.takeOutsideChange(),
			document.blocks.map((block) => block.kind)
		]).toEqual([
			'Hello there, more\n\n## Agent section\n\nAgent text',
			'Hello there, more',
			null,
			['paragraph', 'heading', 'paragraph']
		])
	})

	// through `start`, a caret right where the outside text came in moved after it
	test('the field’s caret goes through the outside change and stays before text that came in at it', () => {
		const document = new Document('# Doc\n\none two three\n')
		const session = document.openEdit(1)
		session.update('one two threez')
		document.mergeFromDisk('# Doc\n\none two three\nagent\n')
		const { edits } = session.takeOutsideChange()!
		expect([
			caretThrough(edits, 14),
			caretThrough(edits, 3),
			caretThrough([{ start: 0, end: 0, insert: 'ab' }], 2)
		]).toEqual([14, 3, 4])
	})

	// a fence typed into a Block and left open made every later Block code, painted and saved so;
	// editmd's input rule makes a code block of that Block alone
	test('a Block left with an open code fence gets it closed when its field closes, in the same undo step', () => {
		const document = new Document('Para one.\n\nPara two.\n')
		const session = document.openEdit(0)
		session.update('```js\nlet a = 1')
		session.close()
		const closed = document.text
		document.undo()

		const fenced = new Document('Para one.\n')
		const done = fenced.openEdit(0)
		done.update('~~~~\nx\n~~~~')
		done.close()
		const source = new Document('Para one.\n')
		const field = source.openSourceEdit()
		field.update('```\nin source mode\n')
		field.close()

		expect([closed, document.text, fenced.text, source.text]).toEqual([
			'```js\nlet a = 1\n```\n\nPara two.\n',
			'Para one.\n\nPara two.\n',
			'~~~~\nx\n~~~~\n',
			'```\nin source mode\n'
		])
	})

	test('a source-mode session spans the whole text, and a disk merge while it is open is deferred into it', () => {
		const document = new Document('# A\n\none\n')
		const session = document.openSourceEdit()
		expect(session.source).toBe('# A\n\none\n')

		session.update('# A\n\none, typed\n')
		document.mergeFromDisk('# A\n\none\n\nagent\n')
		expect(session.hasDeferredMerge).toBe(true)
		expect(document.text).toBe('# A\n\none, typed\n\nagent\n')

		session.update('# A\n\none, typed more\n')
		expect(document.text).toBe('# A\n\none, typed more\n\nagent\n')
	})

	test('undo takes back a ticked task and redo ticks it again', () => {
		const document = new Document('- [ ] a\n')

		document.toggleTask(3)
		expect(document.undo()).toBe(true)
		expect(document.text).toBe('- [ ] a\n')
		expect(document.redo()).toBe(true)
		expect(document.text).toBe('- [x] a\n')
		expect(document.redo()).toBe(false)
	})

	test('an Edit session’s typing is one undo step, and undo keeps a disk merge made after it', () => {
		const document = new Document('# A\n\none\n')
		const session = document.openEdit(1)
		session.update('one,')
		session.update('one, two')
		session.close()
		document.mergeFromDisk('# A\n\none\n\nagent\n')

		expect(document.undo()).toBe(true)
		expect(document.text).toBe('# A\n\none\n\nagent\n')
		expect(document.undo()).toBe(false)
	})

	test('block edits and inserts undo one at a time, and Revert to Saved leaves nothing to undo', () => {
		const document = new Document('Title\n')
		document.editBlock(0, '# Title')
		document.insertBlockAfter(0, '![a](a.png)')

		expect(document.undo()).toBe(true)
		expect(document.text).toBe('# Title\n')
		expect(document.undo()).toBe(true)
		expect(document.text).toBe('Title\n')

		document.redo()
		document.reset('Title\n')
		expect(document.undo()).toBe(false)
		expect(document.redo()).toBe(false)
	})

	test('undoing a session keeps a disk merge that landed between its keystrokes', () => {
		const document = new Document('# A\n\none\n')
		const session = document.openSourceEdit()
		session.update('# A\n\none,\n')
		session.update('# A\n\none, two\n')
		document.mergeFromDisk('# A\n\none\n\nagent\n')
		session.update('# A\n\none, two, three\n')
		session.close()
		expect(document.text).toBe('# A\n\none, two, three\n\nagent\n')

		expect(document.undo()).toBe(true)
		expect(document.text).toBe('# A\n\none\n\nagent\n')
	})

	test('inserting after -1 puts the block first, below any front matter, or into an empty document', () => {
		const plain = new Document('para\n')
		plain.insertBlockAfter(-1, '![a](a.png)')
		expect(plain.text).toBe('![a](a.png)\n\npara\n')

		const withFrontmatter = new Document('---\nt: 1\n---\n\npara\n')
		withFrontmatter.insertBlockAfter(-1, '![a](a.png)')
		expect(withFrontmatter.text).toBe('---\nt: 1\n---\n\n![a](a.png)\n\npara\n')

		const empty = new Document('')
		empty.insertBlockAfter(-1, '![a](a.png)')
		expect(empty.text).toBe('![a](a.png)\n')
	})

	test('a disk merge with no known author is highlighted as an Outside edit, as editmd’s UNKNOWN agent', () => {
		const document = new Document('a\n')
		document.mergeFromDisk('a\n\nb\n')

		expect(
			document.highlights.map(({ author, start, end }) => [author, document.text.slice(start, end)])
		).toEqual([[OUTSIDE_EDIT, 'b']])
		expect(OUTSIDE_EDIT).toEqual({ id: '', name: 'Outside edit' })
	})

	test('a disk merge of a clean document leaves it clean', () => {
		const document = new Document('a\n')
		document.mergeFromDisk('a\n\nb\n')

		expect(document.text).toBe('a\n\nb\n')
		expect(document.isDirty).toBe(false)
	})
})
