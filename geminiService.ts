
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";

const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
};

const processGeminiResponse = (response: GenerateContentResponse): string => {
    // Check for safety blocks first
    if (response.promptFeedback?.blockReason) {
        console.error("Request was blocked by safety settings:", response.promptFeedback);
        let reason = "sababu isiyojulikana";
        switch (response.promptFeedback.blockReason) {
            case 'SAFETY':
                reason = "sera za usalama";
                break;
            case 'OTHER':
                reason = "sababu nyingine";
                break;
        }
        throw new Error(`Ombi lako limezuiwa kwa sababu za ${reason}. Jaribio la kuondoa nguo au kutumia picha isiyofaa linaweza kusababisha hili. Tafadhali jaribu picha tofauti.`);
    }

    if (response.candidates && response.candidates.length > 0) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64Data = part.inlineData.data;
                const mimeType = part.inlineData.mimeType;
                return `data:${mimeType};base64,${base64Data}`;
            }
        }
    }
    
    const textFeedback = response.text?.trim();
    if (textFeedback) {
        console.error("Gemini API returned text instead of an image:", textFeedback);
        throw new Error(`AI haikuweza kutengeneza picha. Jibu la AI: "${textFeedback}"`);
    }

    console.error("Empty response from Gemini API:", response);
    throw new Error("AI imeshindwa kutengeneza picha. Tafadhali jaribu picha tofauti.");
};

interface PersonAnalysis {
    gender: 'man' | 'woman' | 'boy' | 'girl' | 'person';
    ageGroup: 'child' | 'teenager' | 'young adult' | 'adult' | 'senior';
    composition: 'full-body' | 'upper-body' | 'portrait';
}

// Updated function to analyze gender, age, and image composition
const analyzePerson = async (personFile: File): Promise<PersonAnalysis> => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable is not set.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const personImagePart = await fileToGenerativePart(personFile);

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
                parts: [
                    personImagePart,
                    { text: "Analyze the person in this image. Determine their likely gender (man, woman, boy, girl), age group (child, teenager, young adult, adult, senior), and the image composition (is it a 'full-body' shot, an 'upper-body' shot from the waist up, or a 'portrait' showing only head and shoulders?). Respond ONLY with a JSON object." }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        gender: { type: Type.STRING, enum: ['man', 'woman', 'boy', 'girl', 'person'] },
                        ageGroup: { type: Type.STRING, enum: ['child', 'teenager', 'young adult', 'adult', 'senior'] },
                        composition: { type: Type.STRING, enum: ['full-body', 'upper-body', 'portrait']}
                    },
                    required: ['gender', 'ageGroup', 'composition']
                }
            }
        });

        const jsonText = response.text.trim();
        return JSON.parse(jsonText) as PersonAnalysis;
    } catch (e) {
        console.warn("Could not analyze person from image, using default values.", e);
        // Fallback in case of error
        return { gender: 'person', ageGroup: 'adult', composition: 'full-body' };
    }
};

export const dressUpPerson = async (personFile: File, clothingFile: File, temperature: number, material: string, style: string, gender: string, aspectRatio: string, backgroundOption: string, backgroundPrompt: string): Promise<string> => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable is not set.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const analysis = await analyzePerson(personFile);
    const finalGender = gender === 'auto' ? analysis.gender : gender;
    const personDescription = `${analysis.ageGroup} ${finalGender}`;

    const personImagePart = await fileToGenerativePart(personFile);
    const clothingImagePart = await fileToGenerativePart(clothingFile);
    
    let stylePromptPart = '';
    if (style !== 'any' && material !== 'any') {
        stylePromptPart = ` Pay close attention to rendering the clothing in a '${style}' style, using a '${material}' material.`;
    } else if (style !== 'any') {
        stylePromptPart = ` The clothing should be in a '${style}' style.`;
    } else if (material !== 'any') {
        stylePromptPart = ` The clothing should appear to be made of '${material}'.`;
    }

    let backgroundInstruction = `2.  **Preserve Background:** The background of the person's original image must be kept exactly the same.`;
    
    if (backgroundOption === 'generate' && backgroundPrompt.trim() !== '') {
        // User provides a specific prompt
        backgroundInstruction = `2. **Generate New Background:** Remove the person from their original background and place them onto a new, photorealistic, high-quality, and detailed background described as: "${backgroundPrompt}". The lighting, shadows, and reflections on the person and their new clothing must be adjusted to perfectly match the new background's environment.`;
    } else if (backgroundOption === 'suggest') {
        // AI suggests a background based on clothing
        let clothingContext = "the clothing provided";
        if (style !== 'any') {
            clothingContext = `the '${style}' style clothing`;
        }
        backgroundInstruction = `2. **Generate a Relevant Background:** Remove the person from their original background. Generate a new, photorealistic, high-quality, and detailed background that contextually and aesthetically complements ${clothingContext}. For example, formal wear would suit an elegant event or studio, while casual wear fits a relaxed urban or natural setting. The final scene must be cohesive. The lighting, shadows, and reflections on the person and their new clothing must be perfectly adjusted to match the new background's environment.`;
    }


    const prompt = `
      You are an expert virtual stylist. Your primary goal is to seamlessly dress the person from the first image with the clothing from the second image. Your main task is to change the clothing ONLY.

      **Core Rules (Strictly follow):**
      1.  **PRESERVE THE PERSON'S IDENTITY - THIS IS THE MOST IMPORTANT RULE.**
          - **Face and Hair:** The person's face, facial features, expression, and hairstyle MUST remain absolutely identical to the original image. Do NOT change the face.
          - **Body and Pose:** The person's body shape, skin tone, and pose must be preserved exactly as they are in the original photo.
      ${backgroundInstruction}
      3.  **Preserve Framing:** The output image MUST have the same aspect ratio and framing as the original person's image. Do not crop the person.
      
      **Task Details:**
      - The person image is a **${analysis.composition} shot**. You must apply the clothing to the entire visible area appropriate for the garment. For a full-body shot, this means dressing the entire body. For an upper-body shot, dress the torso. For a portrait, dress the visible shoulder area.
      - Adapt the clothing to fit the person's body and pose realistically.
      - Integrate the clothing by matching the lighting, shadows, and textures from the person's original photo (or the new background if one is generated).
      - The person is a ${personDescription}.
      ${stylePromptPart}
      
      **Output Format:**
      - Generate ONLY the final image. Do not include any text, descriptions, or explanations.
    `;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [
                personImagePart,
                clothingImagePart,
                { text: prompt }
            ]
        },
        config: {
            temperature: temperature,
            imageConfig: {
                aspectRatio: aspectRatio
            }
        }
    });

    return processGeminiResponse(response);
};


export const suggestClothing = async (personFile: File, temperature: number, material: string, style: string, gender: string): Promise<string> => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable is not set.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const analysis = await analyzePerson(personFile);
    const finalGender = gender === 'auto' ? analysis.gender : gender;
    const personDescription = `${analysis.ageGroup} ${finalGender}`;

    let prompt = `Generate an image of a single, stylish clothing item suitable for a ${personDescription}.`;
    
    if (style !== 'any' && material !== 'any') {
        prompt += ` The item should be in a '${style}' style and made of '${material}'.`;
    } else if (style !== 'any') {
        prompt += ` The item should be in a '${style}' style.`;
    } else if (material !== 'any') {
        prompt += ` The item should look like it's made of '${material}'.`;
    }
    
    prompt += ` The clothing item should be displayed flat on a plain, neutral white background, as if for an e-commerce website. Do not show any people or mannequins. Only generate the clothing item.`;
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [{ text: prompt }]
        },
        config: {
            temperature: temperature
        }
    });

    return processGeminiResponse(response);
};

export const enhanceImage = async (imageFile: File, temperature: number, aspectRatio: string): Promise<string> => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable is not set.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const imagePart = await fileToGenerativePart(imageFile);

    const prompt = `
      Enhance the provided image.
      - Increase the resolution and sharpness.
      - Improve the lighting and color vibrancy to make it look more professional.
      - Do NOT change the subject, clothing, or background in any way. Only improve the quality.
      - The output image MUST have the same aspect ratio as the input image.
      - Output ONLY the final image.
    `;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [
                imagePart,
                { text: prompt }
            ]
        },
        config: {
            temperature: temperature,
            imageConfig: {
                aspectRatio: aspectRatio
            }
        }
    });
    
    return processGeminiResponse(response);
};
