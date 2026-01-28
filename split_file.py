#!/usr/bin/env python3
"""
Split the filtered email file into 4 separate documents.
Splits by threads to ensure each file contains complete conversations.
"""

import sys
import os
import re


def split_file(input_path, num_parts=4):
    """Split the filtered email file into multiple parts."""
    
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        return
    
    print(f"Reading file: {input_path}")
    
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split content by thread markers
    # Threads start with "################################################################################"
    thread_pattern = r'(#{80}\s+THREAD \d+:)'
    threads = re.split(thread_pattern, content)
    
    # The first element is the header, then alternating thread headers and thread content
    header = threads[0] if threads else ""
    thread_parts = []
    
    # Recombine headers with their content
    for i in range(1, len(threads), 2):
        if i + 1 < len(threads):
            thread_parts.append(threads[i] + threads[i + 1])
    
    total_threads = len(thread_parts)
    threads_per_part = total_threads // num_parts
    remainder = total_threads % num_parts
    
    print(f"Found {total_threads} threads")
    print(f"Splitting into {num_parts} parts (~{threads_per_part} threads per part)")
    
    # Get base filename without extension
    base_path = os.path.splitext(input_path)[0]
    base_name = os.path.basename(base_path)
    # Write to current directory instead of input file directory
    base_dir = os.getcwd()
    
    start_idx = 0
    for part_num in range(1, num_parts + 1):
        # Calculate how many threads for this part
        # Distribute remainder across first parts
        threads_in_part = threads_per_part + (1 if part_num <= remainder else 0)
        end_idx = start_idx + threads_in_part
        
        # Create output filename
        output_path = os.path.join(base_dir, f"{base_name}_part{part_num}.txt")
        
        # Write this part
        with open(output_path, 'w', encoding='utf-8') as outfile:
            # Write header
            outfile.write(header)
            outfile.write(f"\n\n[This is part {part_num} of {num_parts}]\n")
            outfile.write(f"Threads {start_idx + 1} to {end_idx} of {total_threads}\n\n")
            outfile.write("=" * 80 + "\n\n")
            
            # Write threads for this part
            for thread in thread_parts[start_idx:end_idx]:
                outfile.write(thread)
        
        file_size = os.path.getsize(output_path)
        print(f"Created part {part_num}: {output_path} ({file_size/1024/1024:.2f} MB, {threads_in_part} threads)")
        
        start_idx = end_idx
    
    print(f"\nDone! Created {num_parts} files in: {base_dir}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python split_file.py <input_file> [num_parts]")
        print("\nExample:")
        print("  python split_file.py filtered_emails.txt")
        print("  python split_file.py filtered_emails.txt 4")
        sys.exit(1)
    
    input_path = sys.argv[1]
    num_parts = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    
    split_file(input_path, num_parts)


if __name__ == '__main__':
    main()
