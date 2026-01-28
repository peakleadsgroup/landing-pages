#!/usr/bin/env python3
"""
Optimize the filtered email file for Claude projects.
Removes redundant content like signatures, quoted chains, and disclaimers.
Keeps the actual conversation content that's useful for learning email style.
"""

import re
import sys
import os


def remove_signature(text):
    """Remove Daniel's email signature."""
    # Pattern for Daniel's signature
    signature_patterns = [
        r'\[image: Peak Leads Group\].*?Meet With Me.*?\n',
        r'Peak Leads Group.*?Meet With Me.*?\n',
        r'Daniel Wellish\s+Owner, Peak Leads Group\s+Phone:.*?Meet With Me.*?\n',
        r'Daniel Wellish.*?Owner, Peak Leads Group.*?Phone:.*?Website:.*?Meet With Me.*?\n',
    ]
    
    for pattern in signature_patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    return text


def remove_quoted_chains(text):
    """Remove quoted email chains in replies."""
    # Patterns for quoted email chains
    quoted_patterns = [
        r'_{10,}.*?From:.*?Sent:.*?Subject:.*?CAUTION.*?\n',  # Outlook quoted chain
        r'On .*? wrote:.*?\n.*?From:.*?\n.*?Sent:.*?\n.*?To:.*?\n.*?Subject:.*?\n',
        r'_{10,}.*?From:.*?Sent:.*?To:.*?Subject:.*?\n',
        r'CAUTION: This email originated from outside.*?\n',
    ]
    
    for pattern in quoted_patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    return text


def remove_disclaimers(text):
    """Remove legal disclaimers."""
    disclaimer_patterns = [
        r'This email.*?confidential.*?strictly prohibited.*?\n',
        r'CONFIDENTIALITY.*?NOTICE.*?\n',
        r'This message.*?intended recipient.*?\n',
    ]
    
    for pattern in disclaimer_patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    return text


def remove_image_references(text):
    """Remove image references and CID references."""
    text = re.sub(r'\[image:.*?\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[cid:.*?\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[https://.*?\]', '', text)
    return text


def clean_message_body(body):
    """Clean up a single message body."""
    if not body:
        return ""
    
    # Remove signatures
    body = remove_signature(body)
    
    # Remove quoted chains
    body = remove_quoted_chains(body)
    
    # Remove disclaimers
    body = remove_disclaimers(body)
    
    # Remove image references
    body = remove_image_references(body)
    
    # Remove excessive blank lines
    body = re.sub(r'\n{4,}', '\n\n', body)
    
    # Remove leading/trailing whitespace
    body = body.strip()
    
    return body


def optimize_file(input_path, output_path=None):
    """Optimize the email file for Claude."""
    
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        return
    
    if output_path is None:
        base_name = os.path.basename(input_path)
        if base_name.endswith('_filtered.txt'):
            output_path = base_name.replace('_filtered.txt', '_optimized.txt')
        else:
            output_path = os.path.splitext(base_name)[0] + '_optimized.txt'
        output_path = os.path.join(os.getcwd(), output_path)
    
    print(f"Reading: {input_path}")
    
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split into threads - threads start with many # characters followed by "THREAD N:"
    # Pattern: many #, then "THREAD N: Subject", then many #, then content until next thread
    thread_sections = re.split(r'#+\s+THREAD \d+:', content)
    
    threads = []
    for i, section in enumerate(thread_sections[1:], 1):  # Skip first section (header)
        # Find where this thread ends (next thread start or end of file)
        next_thread_match = re.search(r'#{80}\s+THREAD \d+:', section)
        if next_thread_match:
            thread_content = section[:next_thread_match.start()]
        else:
            thread_content = section
        
        # Extract subject from first line
        lines = thread_content.split('\n', 1)
        subject = lines[0].strip() if lines else ""
        thread_body = lines[1] if len(lines) > 1 else ""
        
        threads.append((subject, thread_body))
    
    print(f"Processing {len(threads)} threads...")
    
    optimized_threads = []
    removed_count = 0
    
    for subject, thread_content in threads:
        # Skip threads with empty subjects (usually drafts or empty emails)
        if not subject or subject.lower().strip() in ['', 'none', '(no subject)']:
            removed_count += 1
            continue
        
        # Split thread into messages
        # Messages start with "--- Message X of Y ---"
        message_sections = re.split(r'--- Message \d+ of \d+ in this thread ---', thread_content)
        
        if len(message_sections) < 2:
            continue
        
        optimized_messages = []
        
        for msg_section in message_sections[1:]:  # Skip first empty section
            # Extract headers (From, To, Date, Subject) and body
            # Headers are between "---" and "====", body is after "===="
            header_match = re.search(r'=+\s*\n(.*?)\n=+', msg_section, re.DOTALL)
            if not header_match:
                continue
            
            header_text = header_match.group(1)
            body_start = header_match.end()
            body = msg_section[body_start:].strip()
            
            # Extract From, To, Date, Subject from headers
            from_match = re.search(r'From:\s*(.+?)(?:\n|$)', header_text)
            to_match = re.search(r'To:\s*(.+?)(?:\n|$)', header_text)
            date_match = re.search(r'Date:\s*(.+?)(?:\n|$)', header_text)
            subject_match = re.search(r'Subject:\s*(.+?)(?:\n|$)', header_text)
            
            from_addr = from_match.group(1).strip() if from_match else "Unknown"
            to_addr = to_match.group(1).strip() if to_match else "Unknown"
            date = date_match.group(1).strip() if date_match else "Unknown"
            msg_subject = subject_match.group(1).strip() if subject_match else ""
            
            # Clean the body
            cleaned_body = clean_message_body(body)
            
            # Skip if body is empty or just whitespace
            if not cleaned_body or cleaned_body.lower() in ['[no readable text content]', '']:
                continue
            
            # Format optimized message
            optimized_msg = f"From: {from_addr}\nTo: {to_addr}\nDate: {date}\nSubject: {msg_subject}\n\n{cleaned_body}\n"
            optimized_messages.append(optimized_msg)
        
        # Only include threads with at least one valid message
        if optimized_messages:
            optimized_thread = f"\n{'='*80}\nTHREAD: {subject}\n{'='*80}\n\n" + "\n---\n\n".join(optimized_messages)
            optimized_threads.append(optimized_thread)
    
    print(f"Removed {removed_count} threads with empty subjects")
    print(f"Keeping {len(optimized_threads)} optimized threads")
    
    # Write optimized file
    print(f"Writing optimized file: {output_path}")
    
    with open(output_path, 'w', encoding='utf-8') as outfile:
        outfile.write("="*80 + "\n")
        outfile.write("DANIEL'S EMAIL CONVERSATIONS - OPTIMIZED FOR ANALYSIS\n")
        outfile.write(f"Total threads: {len(optimized_threads)}\n")
        outfile.write("="*80 + "\n\n")
        
        for thread in optimized_threads:
            outfile.write(thread)
            outfile.write("\n\n")
    
    original_size = os.path.getsize(input_path)
    new_size = os.path.getsize(output_path)
    reduction = (1 - new_size / original_size) * 100
    
    print(f"\nDone!")
    print(f"Original size: {original_size/1024/1024:.2f} MB")
    print(f"Optimized size: {new_size/1024/1024:.2f} MB")
    print(f"Reduction: {reduction:.1f}%")
    print(f"\nOutput: {output_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python optimize_emails.py <input_file> [output_file]")
        print("\nExample:")
        print("  python optimize_emails.py filtered_emails.txt")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    optimize_file(input_path, output_path)


if __name__ == '__main__':
    main()
