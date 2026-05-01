require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://lalitambanursery_db_user:iEaqel2M12cyIpW0@lalitambanursery.kphp3gk.mongodb.net/?appName=LALITAMBANURSERY';

async function setupAdmin() {
    try {
        console.log('Connecting to MongoDB Atlas...');
        await mongoose.connect(mongoUri, { 
            useNewUrlParser: true, 
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000 
        });
        console.log('✅ Connected to MongoDB Atlas');
        
        const admins = [
            { email: 'lalitambanursery@gmail.com', username: 'admin_lalitamba', password: 'password123', firstName: 'Nursery', lastName: 'Admin' },
            { email: 'admin@nursery.com', username: 'admin', password: 'password123', firstName: 'System', lastName: 'Admin' }
        ];

        for (const adminData of admins) {
            let user = await User.findOne({ email: adminData.email.toLowerCase() });
            
            if (!user) {
                user = new User({
                    firstName: adminData.firstName,
                    lastName: adminData.lastName,
                    email: adminData.email.toLowerCase(),
                    username: adminData.username.toLowerCase(),
                    password: adminData.password,
                    role: 'admin',
                    isActive: true
                });
                await user.save();
                console.log(`✅ Admin created: ${adminData.email} (Username: ${adminData.username})`);
            } else {
                console.log(`ℹ️ Admin already exists: ${adminData.email}`);
                // Update password and role just in case
                user.password = adminData.password;
                user.role = 'admin';
                user.username = adminData.username.toLowerCase();
                user.isActive = true;
                await user.save();
                console.log(`✅ Admin updated and password reset: ${adminData.email}`);
            }
        }
        
        console.log('\n--- VERIFICATION ---');
        const allAdmins = await User.find({ role: 'admin' });
        console.log(`Total Admin users in DB: ${allAdmins.length}`);
        allAdmins.forEach(a => console.log(`- ${a.email} (${a.username})`));
        
        console.log('\nSetup complete. You can now login at /admin/login');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during admin setup:', err);
        process.exit(1);
    }
}

setupAdmin();
