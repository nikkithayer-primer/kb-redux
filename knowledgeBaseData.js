// Example Knowledge Base with people, places, and things
const knowledgeBase = {
    people: [
        {
            id: "person_1",
            name: "John Smith",
            aliases: ["J. Smith", "Johnny Smith", "John S."],
            type: "person",
            occupation: "Software Engineer", // P106 - occupation
            jobTitle: "Senior Software Engineer", // P39 - position held
            currentEmployer: "Tech Corp", // P108 - employer (current)
            previousEmployers: ["StartupXYZ", "Microsoft"], // P108 - employer (former)
            educatedAt: ["MIT", "Stanford University"], // P69 - educated at
            currentResidence: "San Francisco, CA", // P551 - residence (current)
            previousResidences: ["Boston, MA", "Seattle, WA"], // P551 - residence (former)
            location: "San Francisco, CA", // P551 - residence (legacy field)
            organization: "Tech Corp", // P108 - employer (legacy field)
            dateOfBirth: "1985-03-15", // P569 - date of birth
            gender: "male", // P21 - sex or gender (Q6581097 for male)
            expertise: ["JavaScript", "Machine Learning", "Data Analysis"],
            connections: [
                { id: "person_2", type: "coworker of", reciprocal: "coworker of" },
                { id: "org_1", type: "employee of", reciprocal: "employer of" },
                { id: "place_1", type: "resident of", reciprocal: "residence of" }
            ],
            wikidata_id: null,
            description: "Senior software engineer specializing in AI and web technologies"
        },
        {
            id: "person_2",
            name: "Sarah Johnson",
            aliases: ["S. Johnson", "Sarah J.", "Dr. Johnson"],
            type: "person",
            occupation: "Data Scientist", // P106 - occupation
            jobTitle: "Lead Data Scientist", // P39 - position held
            currentEmployer: "Research Institute", // P108 - employer (current)
            previousEmployers: ["Google", "IBM Research"], // P108 - employer (former)
            educatedAt: ["Harvard University", "University of California Berkeley"], // P69 - educated at
            currentResidence: "Boston, MA", // P551 - residence (current)
            previousResidences: ["Mountain View, CA", "New York, NY"], // P551 - residence (former)
            location: "Boston, MA", // P551 - residence (legacy field)
            organization: "Research Institute", // P108 - employer (legacy field)
            dateOfBirth: "1982-07-22", // P569 - date of birth
            gender: "female", // P21 - sex or gender (Q6581072 for female)
            expertise: ["Statistics", "Python", "Research"],
            connections: [
                { id: "person_1", type: "coworker of", reciprocal: "coworker of" },
                { id: "person_3", type: "former student of", reciprocal: "former professor of" },
                { id: "org_2", type: "employee of", reciprocal: "employer of" },
                { id: "place_2", type: "resident of", reciprocal: "residence of" }
            ],
            wikidata_id: null,
            description: "Lead data scientist with focus on statistical modeling and research"
        },
        {
            id: "person_3",
            name: "Michael Chen",
            aliases: ["M. Chen", "Mike Chen", "Dr. Chen"],
            type: "person",
            occupation: "Professor", // P106 - occupation
            jobTitle: "Professor of Computer Science", // P39 - position held
            currentEmployer: "Stanford University", // P108 - employer (current)
            previousEmployers: ["Carnegie Mellon University", "UC Berkeley"], // P108 - employer (former)
            educatedAt: ["MIT", "Carnegie Mellon University"], // P69 - educated at
            currentResidence: "Stanford, CA", // P551 - residence (current)
            previousResidences: ["Pittsburgh, PA", "Berkeley, CA"], // P551 - residence (former)
            location: "Stanford, CA", // P551 - residence (legacy field)
            organization: "Stanford University", // P108 - employer (legacy field)
            dateOfBirth: "1975-11-08", // P569 - date of birth
            gender: "male", // P21 - sex or gender (Q6581097 for male)
            expertise: ["Computer Science", "AI", "Teaching"],
            connections: [
                { id: "person_2", type: "former professor of", reciprocal: "former student of" },
                { id: "person_4", type: "neighbor of", reciprocal: "neighbor of" },
                { id: "org_3", type: "employee of", reciprocal: "employer of" },
                { id: "place_3", type: "resident of", reciprocal: "residence of" }
            ],
            wikidata_id: null,
            description: "Computer Science professor and AI researcher"
        },
        {
            id: "person_4",
            name: "Emma Wilson",
            aliases: ["E. Wilson", "Emma W."],
            type: "person",
            occupation: "Product Manager", // P106 - occupation
            jobTitle: "Senior Product Manager", // P39 - position held
            currentEmployer: "Big Tech Inc", // P108 - employer (current)
            previousEmployers: ["Apple", "Airbnb"], // P108 - employer (former)
            educatedAt: ["University of Washington", "Northwestern University"], // P69 - educated at
            currentResidence: "Seattle, WA", // P551 - residence (current)
            previousResidences: ["Cupertino, CA", "San Francisco, CA"], // P551 - residence (former)
            location: "Seattle, WA", // P551 - residence (legacy field)
            organization: "Big Tech Inc", // P108 - employer (legacy field)
            dateOfBirth: "1990-09-12", // P569 - date of birth
            gender: "female", // P21 - sex or gender (Q6581072 for female)
            expertise: ["Product Management", "Strategy", "UX"],
            connections: [
                { id: "person_3", type: "neighbor of", reciprocal: "neighbor of" },
                { id: "person_1", type: "sister of", reciprocal: "brother of" },
                { id: "org_4", type: "employee of", reciprocal: "employer of" },
                { id: "place_4", type: "resident of", reciprocal: "residence of" }
            ],
            wikidata_id: null,
            description: "Senior product manager focused on user experience and strategy"
        }
    ],
    
    places: [
        {
            id: "place_1",
            name: "San Francisco",
            aliases: ["SF", "San Fran", "The City"],
            type: "place",
            category: "city", // P31 - instance of
            country: "United States", // P17 - country
            state: "California", // P131 - located in the administrative territorial entity
            population: 873965, // P1082 - population
            coordinates: { lat: 37.7749, lng: -122.4194 }, // P625 - coordinate location
            connections: [
                { id: "person_1", type: "residence of", reciprocal: "resident of" },
                { id: "org_1", type: "headquarters of", reciprocal: "headquartered in" }
            ],
            wikidata_id: "Q62",
            description: "Major tech hub and cultural center in Northern California"
        },
        {
            id: "place_2",
            name: "Boston",
            aliases: ["Beantown", "The Hub"],
            type: "place",
            category: "city",
            country: "United States",
            state: "Massachusetts",
            population: 695506,
            coordinates: { lat: 42.3601, lng: -71.0589 },
            connections: [
                { id: "person_2", type: "residence of", reciprocal: "resident of" },
                { id: "org_2", type: "headquarters of", reciprocal: "headquartered in" }
            ],
            wikidata_id: "Q100",
            description: "Historic city known for education and research institutions"
        },
        {
            id: "place_3",
            name: "Stanford University",
            aliases: ["Stanford", "The Farm"],
            type: "place",
            category: "university",
            country: "United States",
            state: "California",
            founded: 1885,
            coordinates: { lat: 37.4275, lng: -122.1697 },
            connections: [
                { id: "person_3", type: "residence of", reciprocal: "resident of" },
                { id: "org_3", type: "campus of", reciprocal: "located at" }
            ],
            wikidata_id: "Q41506",
            description: "Prestigious private research university in California"
        },
        {
            id: "place_4",
            name: "Seattle",
            aliases: ["Emerald City", "Rain City"],
            type: "place",
            category: "city",
            country: "United States",
            state: "Washington",
            population: 737015,
            coordinates: { lat: 47.6062, lng: -122.3321 },
            connections: [
                { id: "person_4", type: "residence of", reciprocal: "resident of" },
                { id: "org_4", type: "headquarters of", reciprocal: "headquartered in" }
            ],
            wikidata_id: "Q5083",
            description: "Pacific Northwest city known for tech companies and coffee culture"
        }
    ],
    
    organizations: [
        {
            id: "org_1",
            name: "Tech Corp",
            aliases: ["TechCorp", "TC"],
            type: "organization",
            category: "company", // P31 - instance of
            industry: "Technology", // P452 - industry
            founded: 2010, // P571 - inception
            location: "San Francisco, CA", // P159 - headquarters location
            employees: 5000, // P1128 - employees
            connections: [
                { id: "person_1", type: "employer of", reciprocal: "employee of" },
                { id: "place_1", type: "headquartered in", reciprocal: "headquarters of" }
            ],
            wikidata_id: null,
            description: "Leading technology company specializing in AI and cloud services"
        },
        {
            id: "org_2",
            name: "Research Institute",
            aliases: ["RI", "The Institute"],
            type: "organization",
            category: "research",
            industry: "Research",
            founded: 1995,
            location: "Boston, MA",
            employees: 500,
            connections: [
                { id: "person_2", type: "employer of", reciprocal: "employee of" },
                { id: "place_2", type: "headquartered in", reciprocal: "headquarters of" }
            ],
            wikidata_id: null,
            description: "Non-profit research organization focused on data science and statistics"
        },
        {
            id: "org_3",
            name: "Stanford University",
            aliases: ["Stanford", "SU"],
            type: "organization",
            category: "university",
            industry: "Education",
            founded: 1885,
            location: "Stanford, CA",
            employees: 12000,
            connections: [
                { id: "person_3", type: "employer of", reciprocal: "employee of" },
                { id: "place_3", type: "located at", reciprocal: "campus of" }
            ],
            wikidata_id: "Q41506",
            description: "World-renowned private research university"
        },
        {
            id: "org_4",
            name: "Big Tech Inc",
            aliases: ["BigTech", "BTI"],
            type: "organization",
            category: "company",
            industry: "Technology",
            founded: 1975,
            location: "Seattle, WA",
            employees: 200000,
            connections: [
                { id: "person_4", type: "employer of", reciprocal: "employee of" },
                { id: "place_4", type: "headquartered in", reciprocal: "headquarters of" }
            ],
            wikidata_id: null,
            description: "Multinational technology corporation"
        }
    ]
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { knowledgeBase };
}
