const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Image schema
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

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Support extensive image formats
        const allowedTypes = /jpeg|jpg|png|gif|webp|svg|bmp|tiff|tif|ico|avif|heic|heif|jpe|jfif|pjpeg|pjp|svgz/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype.split('/')[1]) || 
                        file.mimetype.startsWith('image/');
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed! Supported formats: JPEG, PNG, GIF, WebP, SVG, BMP, TIFF, ICO, AVIF, HEIC, HEIF'));
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Image management functions
class ImageManager {
    static async uploadImage(file, customName = null) {
        try {
            const imageName = customName || file.originalname;
            
            // Check if image already exists
            const existingImage = await Image.findOne({ name: imageName });
            
            if (existingImage) {
                // Update existing image
                existingImage.data = file.buffer;
                existingImage.contentType = file.mimetype;
                existingImage.size = file.buffer.length;
                existingImage.uploadedAt = new Date();
                await existingImage.save();
                return existingImage;
            } else {
                // Create new image
                const image = new Image({
                    name: imageName,
                    filename: file.originalname,
                    contentType: file.mimetype,
                    data: file.buffer,
                    size: file.buffer.length
                });
                await image.save();
                return image;
            }
        } catch (error) {
            console.error('Error uploading image:', error);
            throw error;
        }
    }
    
    static async getImage(name) {
        try {
            const image = await Image.findOne({ name });
            return image;
        } catch (error) {
            console.error('Error fetching image:', error);
            return null;
        }
    }
    
    static async getAllImages() {
        try {
            const images = await Image.find({});
            return images;
        } catch (error) {
            console.error('Error fetching images:', error);
            return [];
        }
    }
    
    static async deleteImage(name) {
        try {
            const result = await Image.deleteOne({ name });
            return result.deletedCount > 0;
        } catch (error) {
            console.error('Error deleting image:', error);
            return false;
        }
    }
    
    static async syncLocalImages() {
        try {
            console.log('🔄 Syncing local images to database...');
            
            const imagesDir = path.join(__dirname, '../public/images');
            const imageFiles = fs.readdirSync(imagesDir).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            });
            
            let uploadedCount = 0;
            let skippedCount = 0;
            
            for (const filename of imageFiles) {
                const filePath = path.join(imagesDir, filename);
                const fileBuffer = fs.readFileSync(filePath);
                const contentType = `image/${path.extname(filename).substring(1)}`;
                
                try {
                    // Create a file object to match multer format
                    const fileObj = {
                        originalname: filename,
                        mimetype: contentType,
                        buffer: fileBuffer
                    };
                    
                    await this.uploadImage(fileObj, filename);
                    uploadedCount++;
                    console.log(`✅ Uploaded: ${filename}`);
                } catch (error) {
                    if (error.message.includes('duplicate key')) {
                        skippedCount++;
                        console.log(`⚠️  Skipped: ${filename} (already exists)`);
                    } else {
                        console.log(`❌ Failed: ${filename} - ${error.message}`);
                    }
                }
            }
            
            console.log(`📊 Sync complete: ${uploadedCount} uploaded, ${skippedCount} skipped`);
            return { uploadedCount, skippedCount };
        } catch (error) {
            console.error('Error syncing images:', error);
            throw error;
        }
    }
}

module.exports = { ImageManager, upload };
