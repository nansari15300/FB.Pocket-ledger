
"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Feature } from "@/components/layout/AppSidebar";
import { Badge } from "@/components/ui/badge";

interface FeatureListProps {
    features: Feature[];
    selectedFeature: Feature | null;
    onSelectFeature: (feature: Feature) => void;
    featureConfig: Record<string, boolean>;
}

export function FeatureList({
    features,
    selectedFeature,
    onSelectFeature,
    featureConfig,
}: FeatureListProps) {

    if(features.length === 0) {
        return (
            <div className="text-center text-muted-foreground p-8">
                No features found.
            </div>
        )
    }

    return (
        <ScrollArea className="h-[calc(100vh-22rem)] border rounded-lg">
            <div className="pl-master-list-ul">
                {features.map(feature => (
                    <Card 
                        key={feature.id}
                        className={cn("p-3 cursor-pointer", selectedFeature?.id === feature.id && "bg-muted border-primary")}
                        onClick={() => onSelectFeature(feature)}
                    >
                        <div className="flex justify-between items-center">
                            <p className="font-semibold">{feature.label}</p>
                            <Badge variant={featureConfig[feature.id] !== false ? "default" : "secondary"} className={cn(featureConfig[feature.id] !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600')}>
                                {featureConfig[feature.id] !== false ? 'Active' : 'Inactive'}
                            </Badge>
                        </div>
                    </Card>
                ))}
            </div>
        </ScrollArea>
    )
}
