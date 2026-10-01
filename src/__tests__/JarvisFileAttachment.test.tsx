/**
 * JarvisFileAttachment.test.tsx
 *
 * Tests for Jarvis file, document, and photo attachment support.
 */

import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JarvisComposer, formatFileSize } from '../components/jarvis/JarvisComposer';

describe('Jarvis file attachment support', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the attachment button and hidden file input', () => {
    render(<JarvisComposer onSendMessage={vi.fn()} isProcessing={false} />);
    const attachBtn = screen.getByTestId('jarvis-attach-button');
    const fileInput = screen.getByTestId('jarvis-file-input');
    expect(attachBtn).toBeInTheDocument();
    expect(fileInput).toBeInTheDocument();
  });

  it('clicking the attach button triggers the file input click', () => {
    render(<JarvisComposer onSendMessage={vi.fn()} isProcessing={false} />);
    const fileInput = screen.getByTestId('jarvis-file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');
    const attachBtn = screen.getByTestId('jarvis-attach-button');
    fireEvent.click(attachBtn);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('formats file sizes accurately', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('allows attaching files and displays attachment chips with remove functionality', async () => {
    const onSend = vi.fn();
    render(<JarvisComposer onSendMessage={onSend} isProcessing={false} />);

    const fileInput = screen.getByTestId('jarvis-file-input');
    const mockFile = new File(['sample content'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-attachment-chip')).toBeInTheDocument();
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
    });

    // Remove the attachment
    const removeBtn = screen.getByLabelText('Remove notes.txt');
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('jarvis-attachment-chip')).not.toBeInTheDocument();
    });
  });

  it('can submit with an attachment and passes attachment array to onSendMessage', async () => {
    const onSend = vi.fn();
    render(<JarvisComposer onSendMessage={onSend} isProcessing={false} />);

    const fileInput = screen.getByTestId('jarvis-file-input');
    const mockPhoto = new File(['fake image data'], 'diagram.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [mockPhoto] } });

    await waitFor(() => {
      expect(screen.getByText('diagram.png')).toBeInTheDocument();
    });

    const sendBtn = screen.getByTestId('jarvis-composer').querySelector('button[aria-label="Send Message"]') as HTMLButtonElement;
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledTimes(1);
    const [msg, channel, attachments] = onSend.mock.calls[0];
    expect(channel).toBe('typed');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe('diagram.png');
    expect(attachments[0].type).toBe('image/png');

    // List is cleared after send
    expect(screen.queryByTestId('jarvis-attachment-chip')).not.toBeInTheDocument();
  });
});
