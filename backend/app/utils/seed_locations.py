import asyncio
import os
import sys

sys.path.append(os.getcwd())

from backend.app.core import database

locations_data = [
    {"name": "SVU College of Engineering", "category": "Constituent Colleges"},
    {"name": "SVU College of Arts", "category": "Constituent Colleges"},
    {"name": "SVU College of Sciences", "category": "Constituent Colleges"},
    {
        "name": "SVU College of Commerce, Management & Computer Science",
        "category": "Constituent Colleges",
    },
    {
        "name": "SVU College of Pharmaceutical Sciences",
        "category": "Constituent Colleges",
    },
    {
        "name": "Dr. B.R. Ambedkar Law College (Department of Law)",
        "category": "Constituent Colleges",
    },
    {
        "name": "Administrative Building (Neelam Sanjeeva Reddy Bhavan)",
        "category": "Administration",
    },
    {"name": "Examination Section", "category": "Administration"},
    {"name": "Directorate of Admissions", "category": "Administration"},
    {"name": "Research & Development Cell", "category": "Administration"},
    {"name": "NAAC Office", "category": "Administration"},
    {"name": "IQAC Office", "category": "Administration"},
    {"name": "SVU Press", "category": "Administration"},
    {
        "name": "Dept. of Computer Science & Engineering (CSE)",
        "category": "Engineering Departments",
    },
    {
        "name": "Dept. of Electronics & Communication Engineering (ECE)",
        "category": "Engineering Departments",
    },
    {
        "name": "Dept. of Electrical & Electronics Engineering (EEE)",
        "category": "Engineering Departments",
    },
    {"name": "Dept. of Mechanical Engineering", "category": "Engineering Departments"},
    {"name": "Dept. of Civil Engineering", "category": "Engineering Departments"},
    {"name": "Dept. of Chemical Engineering", "category": "Engineering Departments"},
    {"name": "Dept. of Mathematics", "category": "Science Departments"},
    {"name": "Dept. of Physics", "category": "Science Departments"},
    {"name": "Dept. of Chemistry", "category": "Science Departments"},
    {"name": "Dept. of Botany", "category": "Science Departments"},
    {"name": "Dept. of Zoology", "category": "Science Departments"},
    {"name": "Dept. of Biotechnology", "category": "Science Departments"},
    {"name": "Dept. of Microbiology", "category": "Science Departments"},
    {"name": "Dept. of Home Science", "category": "Science Departments"},
    {"name": "Dept. of Statistics", "category": "Science Departments"},
    {"name": "Dept. of Geology", "category": "Science Departments"},
    {"name": "Dept. of Geography", "category": "Science Departments"},
    {"name": "Dept. of Computer Science (MCA)", "category": "Science Departments"},
    {"name": "Dept. of Environmental Sciences", "category": "Science Departments"},
    {"name": "Dept. of Psychology", "category": "Science Departments"},
    {"name": "Dept. of English", "category": "Arts & Humanities"},
    {"name": "Dept. of Telugu Studies", "category": "Arts & Humanities"},
    {"name": "Dept. of Hindi", "category": "Arts & Humanities"},
    {"name": "Dept. of Urdu", "category": "Arts & Humanities"},
    {"name": "Dept. of Sanskrit", "category": "Arts & Humanities"},
    {"name": "Dept. of Economics", "category": "Arts & Humanities"},
    {"name": "Dept. of History", "category": "Arts & Humanities"},
    {
        "name": "Dept. of Political Science & Public Administration",
        "category": "Arts & Humanities",
    },
    {"name": "Dept. of Sociology", "category": "Arts & Humanities"},
    {"name": "Dept. of Social Work", "category": "Arts & Humanities"},
    {"name": "Dept. of Library & Information Science", "category": "Arts & Humanities"},
    {"name": "Dept. of Philosophy", "category": "Arts & Humanities"},
    {"name": "Dept. of Management Studies (MBA)", "category": "Arts & Humanities"},
    {"name": "Dept. of Education", "category": "Arts & Humanities"},
    {"name": "Dept. of Adult & Continuing Education", "category": "Arts & Humanities"},
    {"name": "Oriental Research Institute", "category": "Arts & Humanities"},
    {"name": "Block A (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Block B (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Block C (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Block D (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Block E (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Block F (Boys Hostel - Narayanadri)", "category": "Men's Hostels"},
    {"name": "Block G (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Block H (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Block I (Boys Hostel - Research Scholars)", "category": "Men's Hostels"},
    {"name": "Block J (Boys Hostel - Janardhan Bhavan)", "category": "Men's Hostels"},
    {"name": "Block S (Boys Hostel)", "category": "Men's Hostels"},
    {"name": "Visweswara Bhavan (Engineering)", "category": "Men's Hostels"},
    {"name": "Viswakarma Bhavan (Engineering)", "category": "Men's Hostels"},
    {"name": "Viswateja Bhavan (Engineering)", "category": "Men's Hostels"},
    {"name": "Viswapragathi Bhavan (Engineering)", "category": "Men's Hostels"},
    {
        "name": "SVU Ladies Hostel (Main Block - Premises I)",
        "category": "Women's Hostels",
    },
    {"name": "Priyadarshini Hostel", "category": "Women's Hostels"},
    {"name": "Sarojini Devi Hostel", "category": "Women's Hostels"},
    {"name": "Working Women's Hostel", "category": "Women's Hostels"},
    {"name": "SVU Central Library", "category": "Campus Facilities"},
    {"name": "SVU Health Centre", "category": "Campus Facilities"},
    {"name": "Srinivasa Auditorium", "category": "Campus Facilities"},
    {"name": "Open Air Auditorium", "category": "Campus Facilities"},
    {"name": "Tarakarama Stadium", "category": "Campus Facilities"},
    {"name": "Gymnasium & Indoor Stadium", "category": "Campus Facilities"},
    {"name": "Senate Hall", "category": "Campus Facilities"},
    {"name": "SVU Main Gate", "category": "Campus Facilities"},
    {"name": "SVU Guest House", "category": "Campus Facilities"},
    {"name": "SVU School", "category": "Campus Facilities"},
    {"name": "Day Care Centre", "category": "Campus Facilities"},
    {"name": "Post Office", "category": "Campus Facilities"},
    {"name": "State Bank of India (SVU Branch)", "category": "Campus Facilities"},
    {"name": "Union Bank of India (SVU Branch)", "category": "Campus Facilities"},
    {"name": "SVU Co-operative Store", "category": "Campus Facilities"},
    {"name": "SVU Food Court", "category": "Campus Facilities"},
    {"name": "Lord Venkateswara Swamy Temple", "category": "Campus Facilities"},
]

async def seed():
    database.get_db_client()
    if database.locations_db is not None:
                        
        database.locations_db.delete_many({})
                    
        database.locations_db.insert_many(locations_data)
        print(f"Successfully seeded {len(locations_data)} locations.")
    else:
        print("Error: locations_db is None")

if __name__ == "__main__":
    asyncio.run(seed())
