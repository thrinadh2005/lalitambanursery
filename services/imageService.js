const mongoose = require('mongoose');
const express = require('express');

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

// Image service functions
class ImageService {
    static async getImage(name) {
        try {
            const image = await Image.findOne({ name });
            if (!image) {
                return null;
            }
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
    
    static async saveImage(name, buffer, contentType) {
        try {
            const existingImage = await Image.findOne({ name });
            
            if (existingImage) {
                // Update existing image
                existingImage.data = buffer;
                existingImage.contentType = contentType;
                existingImage.size = buffer.length;
                existingImage.uploadedAt = new Date();
                await existingImage.save();
                return existingImage;
            } else {
                // Create new image
                const image = new Image({
                    name,
                    filename: name,
                    contentType,
                    data: buffer,
                    size: buffer.length
                });
                await image.save();
                return image;
            }
        } catch (error) {
            console.error('Error saving image:', error);
            throw error;
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
}

module.exports = ImageService;
