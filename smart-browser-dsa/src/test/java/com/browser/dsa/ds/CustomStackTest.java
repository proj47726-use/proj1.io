package com.browser.dsa.ds;

import com.browser.dsa.model.TabNode;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class CustomStackTest {

    @Test
    void startsEmpty() {
        CustomStack stack = new CustomStack();
        assertTrue(stack.isEmpty());
        assertEquals(0, stack.getSize());
        assertNull(stack.pop());
        assertNull(stack.peek());
    }

    @Test
    void popsInLastInFirstOutOrder() {
        CustomStack stack = new CustomStack();
        stack.push(new TabNode("1", "first"));
        stack.push(new TabNode("2", "second"));
        stack.push(new TabNode("3", "third"));
        assertEquals(3, stack.getSize());
        assertEquals("third", stack.pop().getTitle());
        assertEquals("second", stack.pop().getTitle());
        assertEquals("first", stack.pop().getTitle());
        assertNull(stack.pop());
        assertTrue(stack.isEmpty());
    }

    @Test
    void peekDoesNotRemove() {
        CustomStack stack = new CustomStack();
        stack.push(new TabNode("7", "only"));
        assertEquals("7", stack.peek().getTabId());
        assertEquals(1, stack.getSize());
    }
}
