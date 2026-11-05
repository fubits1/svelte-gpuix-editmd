/**
 * one Vitest test per section of the headless UI suite; they share one process and one window, so a section depends
 * on what the ones before it left (the order is the suite's)
 */
import './harness.ts'
import { expect, test } from 'vitest'
import * as agents from './agents.ts'
import { countChecks } from './check.ts'
import * as editing from './editing.ts'
import * as files from './files.ts'
import * as find from './find.ts'
import * as links from './links.ts'
import * as menus from './menus.ts'
import * as rendering from './rendering.ts'
import * as view from './view.ts'

let aborted = false

/** a section that throws ends the run there: the sections after it are skipped */
function defineSection(name: string, body: () => Promise<void>): void {
	test(name, async ({ skip }) => {
		if (aborted) skip()

		try {
			await body()
		} catch (error) {
			aborted = true
			throw error
		}
	})
}

defineSection('typingAndKeys', editing.testTypingAndKeys)
defineSection('autosave', files.testAutosave)
defineSection('blocks', rendering.testBlocks)
defineSection('attributionAndNaming', agents.testAttributionAndNaming)
defineSection('diagramsImagesFootnotes', rendering.testDiagramsImagesFootnotes)
defineSection('formatKeys', editing.testFormatKeys)
defineSection('saveKey', files.testSaveKey)
defineSection('blockedAndFileImages', rendering.testBlockedAndFileImages)
defineSection('sourceMergeUndo', editing.testSourceMergeUndo)
defineSection('followLinks', links.testFollowLinks)
defineSection('emptyDocumentHint', rendering.testEmptyDocumentHint)
defineSection('appearanceAndZoom', view.testAppearanceAndZoom)
defineSection('linkDialog', links.testLinkDialog)
defineSection('findBar', find.testFindBar)
defineSection('saveAsCloseOpen', files.testSaveAsCloseOpen)
defineSection('formatTableAndRule', menus.testFormatTableAndRule)
defineSection('imagesAndUnsizedZoom', rendering.testImagesAndUnsizedZoom)
defineSection('deepSocketsFolder', files.testDeepSocketsFolder)
defineSection('commandPalette', menus.testCommandPalette)
defineSection('launchEncodingUntitled', files.testLaunchEncodingUntitled)
defineSection('legendAndIpc', agents.testLegendAndIpc)
defineSection('mermaidPreview', rendering.testMermaidPreview)
defineSection('menuBar', menus.testMenuBar)
defineSection('addLink', links.testAddLink)
defineSection('dragSelectCopy', editing.testDragSelectCopy)
defineSection('revertExitStatus', files.testRevertExitStatus)
defineSection('pageLayout', rendering.testPageLayout)
defineSection('highlightPaint', agents.testHighlightPaint)
defineSection('pixels', rendering.testPixels)
defineSection('changedRuns', agents.testChangedRuns)
defineSection('fieldCommands', editing.testFieldCommands)
defineSection('kindsDropsNewWindow', files.testKindsDropsNewWindow)
defineSection('caretAndFrontMatterGap', rendering.testCaretAndFrontMatterGap)
defineSection('twoAgentsIpc', agents.testTwoAgentsIpc)
defineSection('tickInLightAndDark', rendering.testTickInLightAndDark)
defineSection('openFieldSizesAndLoadCaret', editing.testOpenFieldSizesAndLoadCaret)
defineSection('revealStops', agents.testRevealStops)
defineSection('monoAndSourcePadding', rendering.testMonoAndSourcePadding)
defineSection('whereFindLooks', find.testWhereFindLooks)
defineSection('listContinuation', rendering.testListContinuation)
defineSection('lateProbeReply', editing.testLateProbeReply)
defineSection('renamedElsewhere', files.testRenamedElsewhere)
defineSection('startWritingHint', rendering.testStartWritingHint)
defineSection('commandOnLastEdited', editing.testCommandOnLastEdited)
defineSection('deletionTooltip', agents.testDeletionTooltip)
defineSection('saveAsTxtQuitRevert', files.testSaveAsTxtQuitRevert)
defineSection('refusedInCode', editing.testRefusedInCode)
defineSection('selectionColour', view.testSelectionColour)
defineSection('inlineImagesTables', rendering.testInlineImagesTables)
defineSection('editUndoFromMenu', menus.testEditUndoFromMenu)
defineSection('missingLinkTarget', links.testMissingLinkTarget)
defineSection('remoteImagesAndQuoteLinks', rendering.testRemoteImagesAndQuoteLinks)
defineSection('sameWord', agents.testSameWord)
defineSection('mermaidPreviewClick', rendering.testMermaidPreviewClick)
defineSection('markShortcuts', editing.testMarkShortcuts)
defineSection('pasteAndMatchStyle', menus.testPasteAndMatchStyle)
defineSection('coEditing', editing.testCoEditing)
defineSection('brokenRemoteImage', rendering.testBrokenRemoteImage)
defineSection('headingLinksDialogsTips', links.testHeadingLinksDialogsTips)
defineSection('clickBelowFrontMatter', editing.testClickBelowFrontMatter)
defineSection('currentMatchOnly', find.testCurrentMatchOnly)
defineSection('preselectedNames', files.testPreselectedNames)
defineSection('headingFieldHeight', editing.testHeadingFieldHeight)
defineSection('lockedOwnedPrint', files.testLockedOwnedPrint)
defineSection('definitionsAndCodeLabel', rendering.testDefinitionsAndCodeLabel)
defineSection('sourceUndoAndBatchedCommands', editing.testSourceUndoAndBatchedCommands)
defineSection('nestedBlocks', rendering.testNestedBlocks)
defineSection('revealThroughList', agents.testRevealThroughList)
defineSection('clipboard', editing.testClipboard)
defineSection('listMerges', agents.testListMerges)
defineSection('codeSpansBaselineUnderline', rendering.testCodeSpansBaselineUnderline)
defineSection('scrollbarThumb', view.testScrollbarThumb)

// runs even after an abort, so the count shows how far the suite got
test('every check ran', () => {
	expect(countChecks()).toBe(555)
})
