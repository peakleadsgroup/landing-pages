#!/usr/bin/env python3
"""
Parse MBOX file to extract threads where Daniel either initiated or replied.
Filters out spam and cleans up intermediary codes.

Usage:
    python parse_mbox.py <input.mbox> [output.mbox]

Examples:
    python parse_mbox.py emails.mbox
    python parse_mbox.py emails.mbox filtered_emails.mbox

Features:
    - Extracts only email threads where Daniel (daniel@peakleadsgroup.com) participated
    - Filters out spam/automation emails that Daniel didn't respond to
    - Cleans up base64 encoded attachments and quoted-printable artifacts
    - Preserves email headers and readable text content
    - Groups messages by thread ID (X-GM-THRID)
"""

import mailbox
import email
import re
import os
import sys
from collections import defaultdict
from email.header import decode_header
from email.utils import parseaddr, getaddresses


def decode_mime_words(s):
    """Decode MIME encoded words in header strings."""
    if not s:
        return ""
    decoded_parts = decode_header(s)
    return ''.join(
        part.decode(encoding or 'utf-8', errors='ignore') if isinstance(part, bytes) else part
        for part, encoding in decoded_parts
    )


def get_email_addresses(header_value):
    """Extract email addresses from a header field."""
    if not header_value:
        return []
    addresses = getaddresses([header_value])
    return [addr.lower() for name, addr in addresses if addr]


def is_daniel_email(addr):
    """Check if an email address belongs to Daniel."""
    if not addr:
        return False
    addr_lower = addr.lower()
    return 'daniel' in addr_lower or addr_lower == 'daniel@peakleadsgroup.com'


def is_spam_message(message):
    """Check if a message appears to be spam/automation."""
    subject = decode_mime_words(message.get('Subject', ''))
    from_addr = message.get('From', '')
    
    # Check for common spam/automation indicators
    spam_indicators = [
        'noreply',
        'no-reply',
        'automation',
        'notification',
        'appsheet',
        'airtable',
        'unsubscribe',
        'bounce',
    ]
    
    from_lower = from_addr.lower()
    
    # Check if it's from a noreply address or automation
    if any(indicator in from_lower for indicator in spam_indicators):
        return True
    
    return False


def get_text_content(message):
    """Extract readable text content from an email message."""
    text_parts = []
    
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get('Content-Disposition', ''))
            
            # Skip attachments
            if 'attachment' in content_disposition:
                continue
            
            # Get text content
            if content_type == 'text/plain':
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or 'utf-8'
                        text = payload.decode(charset, errors='ignore')
                        text_parts.append(text)
                except Exception:
                    pass
            elif content_type == 'text/html':
                # Try to get HTML as fallback, but prefer plain text
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or 'utf-8'
                        html = payload.decode(charset, errors='ignore')
                        # Simple HTML to text conversion (remove tags)
                        text = re.sub(r'<[^>]+>', '', html)
                        text = re.sub(r'\s+', ' ', text)
                        if not text_parts:  # Only use HTML if no plain text found
                            text_parts.append(text)
                except Exception:
                    pass
    else:
        # Not multipart, get the payload directly
        try:
            payload = message.get_payload(decode=True)
            if payload:
                charset = message.get_content_charset() or 'utf-8'
                text = payload.decode(charset, errors='ignore')
                text_parts.append(text)
        except Exception:
            pass
    
    return '\n\n'.join(text_parts)


def clean_message_text(text):
    """Clean up message text by removing excessive encoding artifacts."""
    if not text:
        return ""
    
    # Remove excessive base64-like strings (long strings of alphanumeric with = padding)
    text = re.sub(r'[A-Za-z0-9+/]{100,}={0,2}', '', text)
    
    # Remove excessive quoted-printable artifacts
    text = re.sub(r'=\r?\n', '', text)
    text = re.sub(r'=[0-9A-F]{2}', '', text)
    
    # Clean up excessive whitespace
    text = re.sub(r'\n{4,}', '\n\n\n', text)
    text = re.sub(r' {3,}', ' ', text)
    
    return text.strip()


def format_message_for_output(msg):
    """Format a message into a clean, readable text format."""
    from_addr = decode_mime_words(msg.get('From', 'Unknown'))
    to_addr = decode_mime_words(msg.get('To', 'Unknown'))
    subject = decode_mime_words(msg.get('Subject', '(No Subject)'))
    date = msg.get('Date', 'Unknown Date')
    
    # Get text content
    text_content = get_text_content(msg)
    cleaned_text = clean_message_text(text_content)
    
    # Format the message
    output = []
    output.append("=" * 80)
    output.append(f"From: {from_addr}")
    output.append(f"To: {to_addr}")
    output.append(f"Date: {date}")
    output.append(f"Subject: {subject}")
    output.append("=" * 80)
    output.append("")
    
    if cleaned_text:
        output.append(cleaned_text)
    else:
        output.append("[No readable text content]")
    
    output.append("")
    output.append("")
    
    return "\n".join(output)


def parse_mbox(mbox_path, output_path=None):
    """Parse MBOX file and extract threads where Daniel participated."""
    
    daniel_email = 'daniel@peakleadsgroup.com'
    
    # Group messages by thread ID
    threads = defaultdict(list)
    messages_by_id = {}
    
    print(f"Reading MBOX file: {mbox_path}")
    
    try:
        mbox = mailbox.mbox(mbox_path)
    except Exception as e:
        print(f"Error opening MBOX file: {e}")
        return
    
    message_count = 0
    for message in mbox:
        message_count += 1
        thread_id = message.get('X-GM-THRID', '')
        message_id = message.get('Message-ID', '')
        
        if not thread_id:
            # If no thread ID, use a unique identifier
            thread_id = f"no_thread_{message_id}"
        
        threads[thread_id].append(message)
        messages_by_id[message_id] = message
    
    print(f"Found {message_count} messages in {len(threads)} threads")
    
    # Filter threads where Daniel participated
    daniel_threads = []
    
    for thread_id, messages in threads.items():
        daniel_participated = False
        daniel_initiated = False
        daniel_replied = False
        
        # Check each message in the thread
        for msg in messages:
            from_addrs = get_email_addresses(msg.get('From', ''))
            to_addrs = get_email_addresses(msg.get('To', ''))
            cc_addrs = get_email_addresses(msg.get('Cc', ''))
            
            # Check if Daniel sent this message
            if any(is_daniel_email(addr) for addr in from_addrs):
                daniel_participated = True
                if not daniel_initiated:
                    # Check if this is the first message in thread (initiated)
                    # Simple heuristic: if it's the first message chronologically
                    daniel_initiated = True
                daniel_replied = True
            
            # Check if Daniel is in To or Cc (he received it)
            all_recipients = to_addrs + cc_addrs
            if any(is_daniel_email(addr) for addr in all_recipients):
                daniel_participated = True
        
        # Only include threads where Daniel participated
        if daniel_participated:
            # Check if thread is spam (automation/noreply that Daniel didn't respond to)
            # A thread is spam if ALL messages are spam/automation and Daniel never replied
            is_spam_thread = True
            daniel_sent_in_thread = False
            
            for msg in messages:
                if any(is_daniel_email(addr) for addr in get_email_addresses(msg.get('From', ''))):
                    daniel_sent_in_thread = True
                    is_spam_thread = False
                    break
                elif not is_spam_message(msg):
                    # If there's at least one non-spam message, it's not a spam thread
                    is_spam_thread = False
            
            # Only include threads where Daniel actually sent a message (initiated or replied)
            if daniel_sent_in_thread:
                daniel_threads.append((thread_id, messages))
    
    print(f"Found {len(daniel_threads)} threads where Daniel participated")
    
    # Write filtered threads to output file
    if output_path is None:
        # Get the base name of the input file
        base_name = os.path.basename(mbox_path)
        if base_name.endswith('.mbox'):
            base_name = base_name.replace('.mbox', '_filtered.txt')
        else:
            base_name = base_name + '_filtered.txt'
        # Write to current directory instead of same directory as input
        output_path = os.path.join(os.getcwd(), base_name)
    
    print(f"Writing filtered threads to: {output_path}")
    
    total_messages = 0
    with open(output_path, 'w', encoding='utf-8') as outfile:
        # Write header
        outfile.write("=" * 80 + "\n")
        outfile.write("FILTERED EMAIL THREADS - DANIEL'S CONVERSATIONS\n")
        outfile.write(f"Generated from: {mbox_path}\n")
        outfile.write(f"Total threads: {len(daniel_threads)}\n")
        outfile.write("=" * 80 + "\n\n\n")
        
        for thread_idx, (thread_id, messages) in enumerate(daniel_threads, 1):
            # Sort messages by date if available
            try:
                messages.sort(key=lambda m: email.utils.parsedate_to_datetime(
                    m.get('Date', '') or 'Mon, 1 Jan 1970 00:00:00 +0000'
                ))
            except Exception:
                pass
            
            # Write thread header
            subject = decode_mime_words(messages[0].get('Subject', 'No Subject'))
            outfile.write(f"\n{'#' * 80}\n")
            outfile.write(f"THREAD {thread_idx}: {subject}\n")
            outfile.write(f"{'#' * 80}\n\n")
            
            for msg_idx, msg in enumerate(messages, 1):
                total_messages += 1
                outfile.write(f"\n--- Message {msg_idx} of {len(messages)} in this thread ---\n")
                outfile.write(format_message_for_output(msg))
    
    print(f"\nDone! Filtered {len(daniel_threads)} threads ({total_messages} messages) written to {output_path}")
    print(f"Removed {message_count - total_messages} spam/automation messages")
    
    return daniel_threads


def main():
    if len(sys.argv) < 2:
        print("Usage: python parse_mbox.py <mbox_file> [output_file]")
        print("\nExample:")
        print("  python parse_mbox.py emails.mbox")
        print("  python parse_mbox.py emails.mbox cleaned_emails.txt")
        print("\nIf no output file is specified, it will create a .txt file with '_filtered' suffix.")
        sys.exit(1)
    
    mbox_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    # Check if input file exists
    if not os.path.exists(mbox_path):
        print(f"Error: File not found: {mbox_path}")
        sys.exit(1)
    
    parse_mbox(mbox_path, output_path)


if __name__ == '__main__':
    main()
