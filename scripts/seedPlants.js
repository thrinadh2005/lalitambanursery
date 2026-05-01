require('dotenv').config();
const mongoose = require('mongoose');
const Plant = require('../models/Plant');

const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://lalitambanursery_db_user:iEaqel2M12cyIpW0@lalitambanursery.kphp3gk.mongodb.net/?appName=LALITAMBANURSERY';

const samplePlants = [
    {
        name: 'Rose (Red)',
        scientificName: 'Rosa rubiginosa',
        category: 'Flowering Plants',
        price: 150,
        stock: 50,
        description: 'Beautiful red roses for your garden. High quality and disease resistant.',
        isActive: true,
        isFeatured: true,
        images: [{ url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1000&auto=format&fit=crop' }],
        slug: 'rose-red'
    },
    {
        name: 'Money Plant',
        scientificName: 'Epipremnum aureum',
        category: 'Indoor Plants',
        price: 120,
        stock: 100,
        description: 'Easy to grow indoor plant that brings good luck and prosperity.',
        isActive: true,
        isFeatured: true,
        images: [{ url: 'https://images.unsplash.com/photo-1597055181300-e3633a207519?q=80&w=1000&auto=format&fit=crop' }],
        slug: 'money-plant'
    },
    {
        name: 'Mango Tree (Alphonso)',
        scientificName: 'Mangifera indica',
        category: 'Fruit Trees',
        price: 450,
        stock: 20,
        description: 'Premium Alphonso mango sapling. Grafted for early fruiting.',
        isActive: true,
        isFeatured: false,
        images: [{ url: 'https://images.unsplash.com/photo-1591073113125-e46713c829ed?q=80&w=1000&auto=format&fit=crop' }],
        slug: 'mango-tree-alphonso'
    },
    {
        name: 'Aloe Vera',
        scientificName: 'Aloe barbadensis miller',
        category: 'Medicinal Plants',
        price: 80,
        stock: 200,
        description: 'Healing plant with numerous medicinal properties. Low maintenance.',
        isActive: true,
        isFeatured: false,
        images: [{ url: 'https://images.unsplash.com/photo-1596547609652-9cf5d8d76921?q=80&w=1000&auto=format&fit=crop' }],
        slug: 'aloe-vera'
    }
];

async function seedPlants() {
    try {
        console.log('Connecting to MongoDB Atlas...');
        await mongoose.connect(mongoUri, { 
            useNewUrlParser: true, 
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000 
        });
        console.log('✅ Connected to MongoDB Atlas');

        // Check if plants already exist
        const count = await Plant.countDocuments();
        if (count > 0) {
            console.log(`ℹ️ Database already has ${count} plants. Skipping seeding.`);
        } else {
            console.log('Seeding sample plants...');
            await Plant.insertMany(samplePlants);
            console.log('✅ Successfully seeded 4 sample plants!');
        }

        process.exit(0);
    } catch (err) {
        console.error('❌ Error during plant seeding:', err);
        process.exit(1);
    }
}

seedPlants();
