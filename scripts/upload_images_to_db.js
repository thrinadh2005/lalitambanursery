const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Image schema for storing images in database
const imageSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    filename: {
        type: String,
        required: true
    },
    contentType: {
        type: String,
        required: true
    },
    data: {
        type: Buffer,
        required: true
    },
    size: {
        type: Number,
        required: true
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    }
});

const Image = mongoose.model('Image', imageSchema);

// Connect to MongoDB
mongoose.connect('mongodb+srv://bannunanu000_db_user:9Ux1ZrTdttiDzjie@lalitambanursery.lbvalh6.mongodb.net/?appName=LALITAMBANURSERY', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000
})
.then(() => console.log('✅ Connected to MongoDB Atlas'))
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Upload images function
async function uploadImages() {
    try {
        console.log('🚀 Starting image upload process...');
        
        // Images directory
        const imagesDir = path.join(__dirname, 'public/images');
        
        // Get all image files
        const imageFiles = fs.readdirSync(imagesDir).filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });
        
        console.log(`📁 Found ${imageFiles.length} image files to upload`);
        
        for (const filename of imageFiles) {
            const filePath = path.join(imagesDir, filename);
            const fileBuffer = fs.readFileSync(filePath);
            const contentType = `image/${path.extname(filename).substring(1)}`;
            
            // Check if image already exists
            const existingImage = await Image.findOne({ name: filename });
            
            if (existingImage) {
                console.log(`⚠️  Image ${filename} already exists, skipping...`);
                continue;
            }
            
            // Create new image document
            const image = new Image({
                name: filename,
                filename: filename,
                contentType: contentType,
                data: fileBuffer,
                size: fileBuffer.length
            });
            
            await image.save();
            console.log(`✅ Uploaded: ${filename} (${(fileBuffer.length / 1024).toFixed(2)} KB)`);
        }
        
        console.log('🎉 All images uploaded successfully!');
        
        // Display uploaded images
        const uploadedImages = await Image.find({});
        console.log(`\n📊 Total images in database: ${uploadedImages.length}`);
        uploadedImages.forEach(img => {
            console.log(`   - ${img.name} (${(img.size / 1024).toFixed(2)} KB)`);
        });
        
    } catch (error) {
        console.error('❌ Error uploading images:', error);
    } finally {
        mongoose.disconnect();
        console.log('🔌 Disconnected from database');
    }
}

// Run the upload
uploadImages();
