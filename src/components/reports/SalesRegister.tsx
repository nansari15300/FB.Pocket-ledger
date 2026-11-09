
"use client";

import { useFyScopedVouchers } from "@/hooks/useFyScopedVouchers";
import { useState, useMemo, useCallback, useEffect } from "react";
import { TransactionsTable } from "../vouchers/TransactionsTable";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { asCalendarRange, type DateRange } from "@/components/ui/ad-calendar";
import { useDate } from "@/hooks/useDate";
import { useCalendarMonths } from "@/hooks/use-mobile";
import BsDatePicker from "../ui/BsDatePicker";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Printer } from "lucide-react";
import { Calendar } from "../ui/calendar";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";

export function SalesRegister() {
  const { vouchers, loading } = useFyScopedVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const { dateSystem } = useDate();
  const calendarMonths = useCalendarMonths();
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  const fetchUserName = useCallback(async (userId: string): Promise<string> => {
    if (userNames[userId]) return userNames[userId];
    try {
        const userDoc = await getDoc(doc(firestore, 'users', userId));
        if (userDoc.exists()) {
            return userDoc.data().displayName || userDoc.data().email || "Unknown";
        }
    } catch (e) {}
    return "Unknown";
  }, [userNames]);

  useEffect(() => {
      const uids = new Set(vouchers.map((t) => t.userId).filter(Boolean));
      uids.forEach(async (uid) => {
          if (!userNames[uid]) {
              const name = await fetchUserName(uid);
              setUserNames((prev) => ({ ...prev, [uid as any]: name }));
          }
      });
  }, [vouchers, userNames, fetchUserName]);


  const salesVouchers = useMemo(() => {
    let filtered = vouchers.filter(v => v.type === 'sale');
    if (dateRange?.from) {
        const from = dateRange.from;
        const to = dateRange.to || from;
        filtered = filtered.filter(v => {
            const vDate = v.date.toDate();
            return vDate >= from && vDate <= to;
        })
    }
    return filtered;
  }, [vouchers, dateRange]);

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Sales Register</CardTitle>
              <CardDescription>A detailed list of all sales transactions.</CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
          </div>
          <div className="flex items-center gap-2 pt-4">
              {(dateSystem === 'BS' || dateSystem === 'Both') && (
                  <BsDatePicker valueAD={dateRange} onChangeAD={(range) => setDateRange(range as DateRange)} />
              )}
              {(dateSystem === 'AD' || dateSystem === 'Both') && (
                  <Popover>
                      <PopoverTrigger asChild>
                      <Button
                          id="date"
                          variant={"outline"}
                          className={cn("w-auto justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
                      >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dateRange?.from ? (
                          dateRange.to ? (
                              <>
                              {format(dateRange.from, "LLL dd, y")} -{" "}
                              {format(dateRange.to, "LLL dd, y")}
                              </>
                          ) : (
                              format(dateRange.from, "LLL dd, y")
                          )
                          ) : (
                          <span>Pick a date range</span>
                          )}
                      </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                              initialFocus
                              mode="range"
                              defaultMonth={dateRange?.from}
                              selected={asCalendarRange(dateRange)}
                              onSelect={setDateRange}
                              numberOfMonths={calendarMonths}
                          />
                      </PopoverContent>
                  </Popover>
              )}
               {dateRange && <Button variant="ghost" onClick={() => setDateRange(undefined)}>Clear</Button>}
          </div>
        </CardHeader>
        <CardContent>
          <TransactionsTable transactions={salesVouchers} context="daybook" userNames={userNames} />
        </CardContent>
      </Card>
    </div>
  );
}
