
"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { firestore } from "@/lib/firebase";
import { collection, query, where } from "firebase/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { Loader2 } from "lucide-react";
import { CreateDistributorForm } from "@/components/auth/CreateDistributorForm";


export default function DistributorSignupPage() {
  const { user, loading: authLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [applicationStatus, setApplicationStatus] = useState<
    "pending" | "approved" | "rejected" | "not_applied"
  >("not_applied");

  useEffect(() => {
    if (authLoading) return;

    if (user) {
      const checkApplicationStatus = async () => {
        setIsLoading(true);
        const q = query(
          collection(firestore, "distributor_applications"),
          where("userId", "==", user.uid)
        );
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const docData = querySnapshot.docs[0].data();
          setApplicationStatus(docData.status);
        } else {
          setApplicationStatus("not_applied");
        }
        setIsLoading(false);
      };
      checkApplicationStatus();
    } else {
        setIsLoading(false);
    }
  }, [user, authLoading]);


  if (authLoading || isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (applicationStatus !== "not_applied") {
    return (
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
        <Card className="w-full max-w-lg text-center">
          <CardHeader>
            <CardTitle className="font-headline text-3xl">
              Application Status: {applicationStatus.toUpperCase()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {applicationStatus === "pending" && ( <p>Your application is currently under review. Thank you for your patience.</p> )}
            {applicationStatus === "approved" && ( <p>Congratulations! Your application has been approved. You are now a distributor.</p> )}
            {applicationStatus === "rejected" && ( <p>We're sorry, but your application was not approved at this time.</p> )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="font-headline text-2xl">
            Become a Distributor
          </CardTitle>
          <CardDescription>
            Fill out the form below to apply to become a distributor. Your
            application will be reviewed by an admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateDistributorForm onApplicationCreated={() => setApplicationStatus('pending')} />
        </CardContent>
      </Card>
    </div>
  );
}

    