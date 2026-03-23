"""
Compare Fortress Floor Coatings job closes to All Fortress Leads.
Calculate total job amount closed for leads that match.
"""

import csv
import re
from collections import defaultdict

# File paths
JOBS_FILE = r"c:\Users\dr3wh\Downloads\fortress-floor-coatings-jobs-export20260323-96-khg7k2.csv"
LEADS_FILE = r"c:\Users\dr3wh\Downloads\All Fortress Leads - Sheet1.csv"
OUTPUT_FILE = r"c:\Users\dr3wh\OneDrive\Desktop\PeakLeadsGroup\landing-pages\Fortress_Leads_Closed_Breakdown.csv"


def normalize_name(name):
    """Normalize name for matching: lowercase, strip, collapse spaces."""
    if not name or not isinstance(name, str):
        return ""
    return " ".join(name.lower().strip().split())


def parse_job_amount(amount_str):
    """Parse job amount from string like '$6300.00' or '$0.00'."""
    if not amount_str:
        return 0.0
    # Remove $, commas, and any extra chars
    cleaned = re.sub(r'[^\d.\-]', '', str(amount_str))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def load_leads(filepath):
    """Load lead names from All Fortress Leads CSV."""
    leads = set()
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row in reader:
            if row and row[0].strip():
                name = normalize_name(row[0])
                if name:
                    leads.add(name)
    return leads


def load_jobs(filepath):
    """Load jobs with customer names and amounts."""
    jobs = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            customer = row.get('Customer name', '').strip()
            if customer:
                amount_str = row.get('Job amount', '$0.00')
                amount = parse_job_amount(amount_str)
                jobs.append({
                    'customer': customer,
                    'customer_normalized': normalize_name(customer),
                    'amount': amount,
                    'job_num': row.get('Job #', ''),
                    'status': row.get('Job status', ''),
                })
    return jobs


def main():
    print("Loading leads...")
    leads = load_leads(LEADS_FILE)
    print(f"  Loaded {len(leads)} unique lead names")

    print("\nLoading jobs...")
    jobs = load_jobs(JOBS_FILE)
    print(f"  Loaded {len(jobs)} jobs")

    # Find matching jobs and sum amounts
    total_amount = 0.0
    matching_jobs = []
    matched_customers = set()

    for job in jobs:
        norm = job['customer_normalized']
        # Direct match
        if norm in leads:
            total_amount += job['amount']
            matching_jobs.append(job)
            matched_customers.add(job['customer'])

    # Also try partial/fuzzy: e.g. "Bob Kortenber" in leads might match "Bob Kortenber" in jobs
    # Check for "First Last" vs "Last, First" or similar variations
    # For now we're doing exact normalized match

    print("\n" + "="*60)
    print("RESULTS")
    print("="*60)
    print(f"\nUnique leads in All Fortress Leads: {len(leads)}")
    print(f"Total jobs in closes export: {len(jobs)}")
    print(f"\nMatching customers (in both leads and jobs): {len(matched_customers)}")
    print(f"Total job lines matching: {len(matching_jobs)}")
    print(f"\n*** TOTAL JOB AMOUNT CLOSED (matches): ${total_amount:,.2f} ***")

    # Show which customers matched
    print("\n--- Matched customers and their closed amounts ---")
    by_customer = defaultdict(float)
    for j in matching_jobs:
        by_customer[j['customer']] += j['amount']

    for customer in sorted(by_customer.keys()):
        amt = by_customer[customer]
        if amt > 0:  # Only show those with actual revenue
            print(f"  {customer}: ${amt:,.2f}")

    # Jobs with $0 (Day 2, etc.) still count as matches but don't add to revenue
    zero_amt = sum(1 for j in matching_jobs if j['amount'] == 0)
    if zero_amt:
        print(f"\n  (Plus {zero_amt} matching job line(s) with $0 amount)")

    # Write breakdown to CSV file
    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Fortress Leads - Closed Jobs Breakdown'])
        writer.writerow([f'Generated: Total closed for matching leads: ${total_amount:,.2f}'])
        writer.writerow([f'Matching customers: {len(matched_customers)}'])
        writer.writerow([])

        # Summary by customer
        writer.writerow(['SUMMARY BY CUSTOMER'])
        writer.writerow(['Customer Name', 'Total Closed Amount'])
        for customer in sorted(by_customer.keys(), key=lambda x: by_customer[x], reverse=True):
            amt = by_customer[customer]
            writer.writerow([customer, f'${amt:,.2f}'])
        writer.writerow([])
        writer.writerow(['TOTAL', f'${total_amount:,.2f}'])
        writer.writerow([])

        # Detail: each matching job
        writer.writerow(['DETAIL - EACH MATCHING JOB'])
        writer.writerow(['Customer Name', 'Job #', 'Job Amount', 'Job Status'])
        for job in matching_jobs:
            writer.writerow([
                job['customer'],
                job['job_num'],
                f"${job['amount']:,.2f}",
                job['status']
            ])

    print(f"\nBreakdown saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
