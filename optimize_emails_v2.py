#!/usr/bin/env python3
"""
Optimize the filtered email file for Claude projects.
Processes line by line for better performance.
"""

import re
import sys
import os


def remove_signature(text):
    """Remove Daniel's email signature."""
    # More aggressive signature removal
    patterns = [
        # Calendar links
        r'<https://cal\.com/.*?>',
        r'https://cal\.com/.*?\n',
        # Signature blocks
        r'\[image: Peak Leads Group\].*?Meet With Me.*?',
        r'Daniel Wellish\s+Owner, Peak Leads Group.*?Meet With Me.*?',
        r'Peak Leads Group.*?Daniel Wellish.*?Owner.*?Phone:.*?Website:.*?Meet With Me.*?',
        r'Daniel Wellish.*?Owner.*?Phone:.*?Website:.*?',
        r'Peak Leads Group.*?Phone:.*?Website:.*?',
        # Phone/website lines
        r'Phone:.*?\n',
        r'Website:.*?\n',
        r'Meet With Me.*?\n',
    ]
    
    for pattern in patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    return text


def remove_quoted_chains(text):
    """Remove quoted email chains in replies."""
    patterns = [
        r'_{10,}.*?From:.*?Sent:.*?Subject:.*?CAUTION.*',
        r'On .*? wrote:.*?From:.*?Sent:.*?To:.*?Subject:.*',
        r'CAUTION: This email originated from outside.*',
    ]
    
    for pattern in patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    return text


def remove_disclaimers(text):
    """Remove legal disclaimers."""
    patterns = [
        r'This email.*?confidential.*?strictly prohibited.*',
        r'CONFIDENTIALITY.*?NOTICE.*',
        r'This message.*?intended recipient.*',
    ]
    
    for pattern in patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    return text


def clean_body(text):
    """Clean up message body."""
    if not text:
        return ""
    
    # Remove signatures
    text = remove_signature(text)
    
    # Remove quoted chains
    text = remove_quoted_chains(text)
    
    # Remove disclaimers
    text = remove_disclaimers(text)
    
    # Remove image references
    text = re.sub(r'\[image:.*?\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[cid:.*?\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[https://.*?\]', '', text)
    
    # Remove tel: links
    text = re.sub(r'<tel:.*?>', '', text)
    
    # Remove standalone URLs that are just calendar links
    text = re.sub(r'^https://cal\.com/.*$', '', text, flags=re.MULTILINE)
    
    # Remove lines that are just URLs
    text = re.sub(r'^https?://.*$', '', text, flags=re.MULTILINE)
    
    # Remove excessive blank lines
    text = re.sub(r'\n{4,}', '\n\n', text)
    
    # Remove trailing whitespace from each line
    lines = [line.rstrip() for line in text.split('\n')]
    text = '\n'.join(lines)
    
    return text.strip()


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
    
    with open(input_path, 'r', encoding='utf-8') as infile, \
         open(output_path, 'w', encoding='utf-8') as outfile:
        
        outfile.write("="*80 + "\n")
        outfile.write("DANIEL'S EMAIL CONVERSATIONS - OPTIMIZED FOR ANALYSIS\n")
        outfile.write("="*80 + "\n\n")
        
        current_thread_subject = None
        current_message = None
        in_message_body = False
        collecting_headers = False
        headers = {}
        body_lines = []
        thread_count = 0
        message_count = 0
        skipped_threads = 0
        
        for line in infile:
            # Detect thread start - look for lines with many # followed by THREAD
            if line.startswith('#') and 'THREAD' in line:
                    # Extract subject
                    match = re.search(r'THREAD \d+:\s*(.+)', line)
                    if match:
                        current_thread_subject = match.group(1).strip()
                        # Skip empty subjects
                        if not current_thread_subject or current_thread_subject.lower() in ['', 'none', '(no subject)']:
                            current_thread_subject = None
                            skipped_threads += 1
                            continue
                        
                        # Write previous thread if exists
                        if current_message and headers:
                            body_text = clean_body('\n'.join(body_lines))
                            if body_text:
                                write_message(outfile, headers, body_text)
                                message_count += 1
                        
                        # Start new thread
                        if current_thread_subject:
                            outfile.write(f"\n{'='*80}\nTHREAD: {current_thread_subject}\n{'='*80}\n\n")
                            thread_count += 1
                        
                        current_message = None
                        headers = {}
                        body_lines = []
                        in_message_body = False
                        collecting_headers = False
                    continue
            
            # Detect message start
            if '--- Message' in line and 'in this thread ---' in line:
                # Write previous message if exists
                if current_message and headers:
                    body_text = clean_body('\n'.join(body_lines))
                    if body_text:
                        write_message(outfile, headers, body_text)
                        message_count += 1
                
                current_message = True
                headers = {}
                body_lines = []
                in_message_body = False
                collecting_headers = False
                continue
            
            # Detect header section start
            if line.startswith('=' * 80):
                if not collecting_headers:
                    collecting_headers = True
                    continue
                else:
                    # End of headers, start of body
                    collecting_headers = False
                    in_message_body = True
                    continue
            
            # Collect headers
            if collecting_headers:
                if 'From:' in line:
                    headers['From'] = line.replace('From:', '').strip()
                elif 'To:' in line:
                    headers['To'] = line.replace('To:', '').strip()
                elif 'Date:' in line:
                    headers['Date'] = line.replace('Date:', '').strip()
                elif 'Subject:' in line:
                    headers['Subject'] = line.replace('Subject:', '').strip()
                continue
            
            # Collect body
            if in_message_body:
                body_lines.append(line.rstrip())
        
        # Write last message
        if current_message and headers:
            body_text = clean_body('\n'.join(body_lines))
            if body_text:
                write_message(outfile, headers, body_text)
                message_count += 1
    
    original_size = os.path.getsize(input_path)
    new_size = os.path.getsize(output_path)
    reduction = (1 - new_size / original_size) * 100
    
    print(f"\nDone!")
    print(f"Threads processed: {thread_count}")
    print(f"Messages kept: {message_count}")
    print(f"Skipped threads: {skipped_threads}")
    print(f"Original size: {original_size/1024/1024:.2f} MB")
    print(f"Optimized size: {new_size/1024/1024:.2f} MB")
    print(f"Reduction: {reduction:.1f}%")
    print(f"\nOutput: {output_path}")


def write_message(outfile, headers, body):
    """Write a cleaned message to the output file."""
    outfile.write(f"From: {headers.get('From', 'Unknown')}\n")
    outfile.write(f"To: {headers.get('To', 'Unknown')}\n")
    outfile.write(f"Date: {headers.get('Date', 'Unknown')}\n")
    outfile.write(f"Subject: {headers.get('Subject', '')}\n")
    outfile.write(f"\n{body}\n\n---\n\n")


def main():
    if len(sys.argv) < 2:
        print("Usage: python optimize_emails_v2.py <input_file> [output_file]")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    optimize_file(input_path, output_path)


if __name__ == '__main__':
    main()
