
import React, { useState, useCallback, useRef } from 'react';
import { dressUpPerson, enhanceImage, suggestClothing } from './services/geminiService';
import { Header } from './components/Header';
import { ImageDisplay } from './components/ImageDisplay';
import { Controls } from './components/Controls';
import { ProgressDisplay } from './components/ProgressDisplay';
import { History, GeneratedImage } from './components/History';

// Utility to convert base64 data URL to a File object
const dataURLtoFile = (dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    // The regex might fail if the mime type is not present
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) {
        throw new Error('Invalid data URL');
    }
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

const getClosestAspectRatio = (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        const supportedRatios: { [key: string]: number } = {
          '1:1': 1,
          '3:4': 0.75,
          '4:3': 1.3333,
          '9:16': 0.5625,
          '16:9': 1.7777,
        };
        let closestRatio = '1:1';
        let minDiff = Math.abs(ratio - supportedRatios['1:1']);

        for (const [key, value] of Object.entries(supportedRatios)) {
          const diff = Math.abs(ratio - value);
          if (diff < minDiff) {
            minDiff = diff;
            closestRatio = key;
          }
        }
        resolve(closestRatio);
      };
      if (e.target?.result) {
        img.src = e.target.result as string;
      } else {
        resolve('1:1'); // Fallback
      }
    };
    reader.readAsDataURL(file);
  });
};

const getErrorMessage = (error: unknown): React.ReactNode => {
    if (error instanceof Error) {
        if (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota')) {
            return (
                <div className="text-center">
                    <p className="font-bold text-lg mb-2">Kiwango cha Matumizi Kimezidishwa</p>
                    <p>
                        Umezidi kiwango cha matumizi cha sasa cha API. Hii inaweza kuwa kikomo cha muda.
                        Tafadhali jaribu tena baada ya muda mfupi.
                    </p>
                    <div className="mt-3 flex justify-center gap-4 text-sm">
                        <a 
                            href="https://ai.google.dev/gemini-api/docs/rate-limits" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="underline font-bold hover:text-red-100"
                        >
                            Jifunze kuhusu Viwango
                        </a>
                        <a 
                            href="https://ai.dev/rate-limit" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="underline font-bold hover:text-red-100"
                        >
                            Fuatilia Matumizi
                        </a>
                    </div>
                </div>
            );
        }
        return <p className="text-center">{error.message}</p>;
    }
    return <p className="text-center">Samahani, kumeshindikana kutekeleza ombi. Tafadhali jaribu tena.</p>;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const App: React.FC = () => {
  const [personImage, setPersonImage] = useState<string | null>(null);
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [clothingImage, setClothingImage] = useState<string | null>(null);
  const [clothingFile, setClothingFile] = useState<File | null>(null);

  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isEnhancing, setIsEnhancing] = useState<boolean>(false);
  const [isSuggestingClothing, setIsSuggestingClothing] = useState<boolean>(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [material, setMaterial] = useState<string>('any');
  const [style, setStyle] = useState<string>('any');
  const [gender, setGender] = useState<string>('auto');
  const [personImageAspectRatio, setPersonImageAspectRatio] = useState<string>('1:1');
  const [backgroundOption, setBackgroundOption] = useState<string>('original');
  const [backgroundPrompt, setBackgroundPrompt] = useState<string>('');

  const progressIntervalRef = useRef<number | null>(null);

  const startProgressSimulation = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setProgress(0);
    
    progressIntervalRef.current = window.setInterval(() => {
        setProgress(prev => {
            if (prev >= 95) {
                if(progressIntervalRef.current) clearInterval(progressIntervalRef.current);
                return 95;
            }
            // Simulate slower progress as it gets closer to the end
            const increment = Math.max(1, 10 - Math.floor(prev / 10));
            return Math.min(prev + increment, 95);
        });
    }, 800);
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = null;
    setProgress(100);
    setTimeout(() => setProgress(0), 500);
  };


  const handlePersonImageUpload = async (file: File) => {
    setPersonFile(file);
    const aspectRatio = await getClosestAspectRatio(file);
    setPersonImageAspectRatio(aspectRatio);
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setPersonImage(reader.result as string);
    };
    reader.readAsDataURL(file);
    setGeneratedImage(null);
    setError(null);
  };
  
  const handleClothingImageUpload = (file: File) => {
    setClothingFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setClothingImage(reader.result as string);
    };
    reader.readAsDataURL(file);
    setGeneratedImage(null);
    setError(null);
  };

  const handleSuggestAndDressUpClick = useCallback(async () => {
    if (!personFile) {
      setError("Tafadhali pakia picha yako kwanza ili kupata wazo la nguo.");
      return;
    }
    
    setIsSuggestingClothing(true);
    setError(null);
    setClothingFile(null);
    setClothingImage(null);
    setGeneratedImage(null);
    setLoadingMessage("Inatafuta wazo la nguo...");
    startProgressSimulation();

    try {
      const suggestedUrl = await suggestClothing(personFile, 0.8, material, style, gender);
      const suggestedFile = dataURLtoFile(suggestedUrl, 'suggested-clothing.png');
      
      setClothingImage(suggestedUrl);
      setClothingFile(suggestedFile);
      setIsSuggestingClothing(false);

      await sleep(1500); 

      setIsLoading(true);
      setLoadingMessage("Inakuvalisha nguo...");
      const newImageUrl = await dressUpPerson(personFile, suggestedFile, 0.8, material, style, gender, personImageAspectRatio, backgroundOption, backgroundPrompt);
      const newImage: GeneratedImage = { url: newImageUrl, downloadable: true };
      setGeneratedImage(newImage);
      setHistory(prevHistory => [newImage, ...prevHistory]);

    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      stopProgressSimulation();
      setIsSuggestingClothing(false);
      setIsLoading(false);
    }
  }, [personFile, material, style, gender, personImageAspectRatio, backgroundOption, backgroundPrompt]);


  const handleGenerateClick = useCallback(async () => {
    if (!personFile || !clothingFile) {
      setError('Tafadhali pakia picha ya mtu na picha ya nguo.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setGeneratedImage(null);
    setLoadingMessage("Inatengeneza muonekano...");
    startProgressSimulation();

    try {
      const newImageUrl = await dressUpPerson(personFile, clothingFile, 0.8, material, style, gender, personImageAspectRatio, backgroundOption, backgroundPrompt);
      
      const newImage: GeneratedImage = { url: newImageUrl, downloadable: true };
      setGeneratedImage(newImage);
      setHistory(prevHistory => [newImage, ...prevHistory]);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err));
    } finally {
      stopProgressSimulation();
      setIsLoading(false);
    }
  }, [personFile, clothingFile, material, style, gender, personImageAspectRatio, backgroundOption, backgroundPrompt]);


  const handleEnhanceClick = useCallback(async () => {
    if (!generatedImage) {
        setError("Hakuna picha ya kung'arisha.");
        return;
    }

    setIsEnhancing(true);
    setError(null);
    setLoadingMessage("Inang'arisha picha...");
    startProgressSimulation();
    
    try {
        const imageFile = dataURLtoFile(generatedImage.url, 'generated-image.png');
        const enhancedUrl = await enhanceImage(imageFile, 0.8, personImageAspectRatio);
        const enhancedImage: GeneratedImage = {
            url: enhancedUrl,
            downloadable: generatedImage.downloadable // Inherit download status
        };
        setGeneratedImage(enhancedImage);
        setHistory(prevHistory => [enhancedImage, ...prevHistory]);
    } catch (err) {
        console.error(err);
        setError(getErrorMessage(err));
    } finally {
        stopProgressSimulation();
        setIsEnhancing(false);
    }
}, [generatedImage, personImageAspectRatio]);


  const handleHistoryClick = (image: GeneratedImage) => {
    setGeneratedImage(image);
  };
  
  const isProcessing = isLoading || isEnhancing || isSuggestingClothing;

  const rightPanelTitle = generatedImage ? "Muonekano Mpya" : "Matokeo";
  const rightPanelImageUrl = generatedImage?.url || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-slate-800 text-gray-100 font-sans">
      <Header />
      <main className="container mx-auto p-4 md:p-8">
        <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl shadow-2xl p-6 md:p-8 border border-slate-700">
          
          <Controls
            onPersonImageUpload={handlePersonImageUpload}
            onClothingImageUpload={handleClothingImageUpload}
            onSuggestAndDressUp={handleSuggestAndDressUpClick}
            onGenerate={handleGenerateClick}
            isLoading={isProcessing}
            personSelected={!!personFile}
            clothingSelected={!!clothingFile}
            material={material}
            onMaterialChange={setMaterial}
            style={style}
            onStyleChange={setStyle}
            gender={gender}
            onGenderChange={setGender}
            backgroundOption={backgroundOption}
            onBackgroundOptionChange={setBackgroundOption}
            backgroundPrompt={backgroundPrompt}
            onBackgroundPromptChange={setBackgroundPrompt}
          />
          
          {error && (
            <div className="mt-6 bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg" role="alert">
              {error}
            </div>
          )}

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            <ImageDisplay title="Picha Halisi" imageUrl={personImage} isDimmed={isProcessing} />
            <ImageDisplay title="Picha ya Nguo" imageUrl={clothingImage} isDimmed={isProcessing} />
            
            <div className="relative">
              {isProcessing && (
                <div className="absolute inset-0 flex flex-col justify-center items-center bg-slate-800/80 rounded-xl z-10 backdrop-blur-sm p-4">
                  <ProgressDisplay progress={progress} message={loadingMessage} />
                </div>
              )}
              <ImageDisplay 
                title={rightPanelTitle} 
                imageUrl={rightPanelImageUrl}
                isDownloadable={generatedImage?.downloadable}
                onEnhance={generatedImage && !isProcessing ? handleEnhanceClick : undefined}
              />
            </div>
          </div>
            
          <div className={`transition-opacity duration-300 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
            <History images={history} onImageClick={handleHistoryClick} />
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;
