package com.browser.dsa.ds;

import com.browser.dsa.model.HistorySnapshot;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CustomDoublyLinkedListTest {

    private CustomDoublyLinkedList listOf(String... urls) {
        CustomDoublyLinkedList list = new CustomDoublyLinkedList();
        for (String url : urls) list.visit(url);
        return list;
    }

    @Test
    void startsEmpty() {
        CustomDoublyLinkedList list = new CustomDoublyLinkedList();
        assertNull(list.getCurrent());
        assertEquals(0, list.getSize());
        assertEquals(0, list.getPosition());
        assertNull(list.back());
        assertNull(list.forward());
    }

    @Test
    void firstVisitBecomesHeadAndCurrent() {
        CustomDoublyLinkedList list = listOf("a");
        assertSame(list.getHead(), list.getCurrent());
        assertEquals(1, list.getSize());
        assertEquals(1, list.getPosition());
    }

    @Test
    void visitsChainInOrder() {
        CustomDoublyLinkedList list = listOf("a", "b", "c");
        assertEquals("c", list.getCurrent().getUrl());
        assertEquals(3, list.getSize());
        assertEquals(List.of("a", "b", "c"), list.snapshot().urls());
    }

    @Test
    void backAndForwardMoveTheCurrentPointer() {
        CustomDoublyLinkedList list = listOf("a", "b", "c");
        assertEquals("b", list.back().getUrl());
        assertEquals("a", list.back().getUrl());
        assertEquals("b", list.forward().getUrl());
        assertEquals(2, list.getPosition());
        assertEquals(3, list.getSize());          // moving never deletes anything
    }

    @Test
    void backStopsAtFirstPageAndForwardStopsAtLast() {
        CustomDoublyLinkedList list = listOf("a", "b");
        list.back();
        assertEquals("a", list.back().getUrl());
        assertEquals(1, list.getPosition());
        list.forward();
        assertEquals("b", list.forward().getUrl());
        assertEquals(2, list.getPosition());
    }

    @Test
    void visitingMidHistoryDiscardsForwardPages() {
        CustomDoublyLinkedList list = listOf("a", "b", "c", "d");
        list.back();
        list.back();                               // now on b
        list.visit("x");                           // c and d must vanish
        HistorySnapshot snap = list.snapshot();
        assertEquals(List.of("a", "b", "x"), snap.urls());
        assertEquals(3, snap.size());
        assertEquals(3, snap.position());
        assertEquals("x", snap.currentUrl());
        assertFalse(snap.hasNext());
        assertNull(list.forward().getNext());
        assertEquals("x", list.forward().getUrl()); // forward is a no-op now
    }

    @Test
    void sizeStaysCorrectAfterRepeatedBranching() {
        CustomDoublyLinkedList list = listOf("a", "b", "c");
        list.back();
        list.visit("d");      // a b d
        list.back();
        list.back();
        list.visit("e");      // a e
        assertEquals(2, list.getSize());
        assertEquals(List.of("a", "e"), list.snapshot().urls());
    }

    @Test
    void jumpToMovesToAnyPageAndRejectsBadIndexes() {
        CustomDoublyLinkedList list = listOf("a", "b", "c", "d");
        assertEquals("a", list.jumpTo(1).getUrl());
        assertEquals("c", list.jumpTo(3).getUrl());
        assertEquals(3, list.getPosition());
        assertNull(list.jumpTo(0));
        assertNull(list.jumpTo(5));
        assertEquals(3, list.getPosition());       // failed jumps change nothing
        assertEquals(4, list.getSize());
    }

    @Test
    void clearEmptiesTheList() {
        CustomDoublyLinkedList list = listOf("a", "b");
        list.clear();
        assertNull(list.getHead());
        assertNull(list.getCurrent());
        assertEquals(0, list.getSize());
        assertEquals(0, list.getPosition());
        list.visit("z");                           // usable again after clearing
        assertEquals(1, list.getSize());
    }

    @Test
    void snapshotReportsNeighbours() {
        CustomDoublyLinkedList list = listOf("a", "b", "c");
        list.back();
        HistorySnapshot snap = list.snapshot();
        assertTrue(snap.hasPrev());
        assertTrue(snap.hasNext());
        assertEquals(2, snap.position());
    }
}
