// 参考《算法题讲义》第 2 章（第 8-24 页）。
// 顺序表：使用下标 0 到 n - 1 的数组。

// 顺序查找：可用于无序表，返回首个匹配下标；找不到返回 -1。O(n)
int linearSearch(const int a[], int n, int target) {
    for (int i = 0; i < n; ++i) {
        if (a[i] == target) return i;
    }
    return -1;
}

// 折半查找：非降序表，闭区间 [left, right]。O(log n)
int binarySearch(const int a[], int n, int target) {
    int left = 0;
    int right = n - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (a[mid] == target) return mid;
        if (a[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}

// 区间收敛：返回第一个 >= target 的下标，若不存在则返回 n。O(log n)
int lowerBound(const int a[], int n, int target) {
    int left = 0;
    int right = n;  // n 是允许返回的边界，不读取 a[n]。
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (a[mid] < target) left = mid + 1;
        else right = mid;
    }
    return left;
}

// 直接计数：值域为 [0, limit)，count 至少有 limit 项。O(n + limit)
void countValues(const int a[], int n, int count[], int limit) {
    for (int value = 0; value < limit; ++value) count[value] = 0;
    for (int i = 0; i < n; ++i) ++count[a[i]];
}

// 前缀和：prefix 至少有 n + 1 项，prefix[i] 是前 i 项的和。O(n)
void buildPrefix(const int a[], int n, long long prefix[]) {
    prefix[0] = 0;
    for (int i = 0; i < n; ++i) prefix[i + 1] = prefix[i] + a[i];
}

// 查询闭区间 [left, right] 的和。O(1)
long long rangeSum(const long long prefix[], int left, int right) {
    return prefix[right + 1] - prefix[left];
}

// 双指针归并：a、b 均为非降序，out 至少有 n + m 项且不与输入重叠。O(n + m)
void mergeSorted(const int a[], int n, const int b[], int m, int out[]) {
    int i = 0;
    int j = 0;
    int k = 0;
    while (i < n && j < m) {
        if (a[i] <= b[j]) out[k++] = a[i++];
        else out[k++] = b[j++];
    }
    while (i < n) out[k++] = a[i++];
    while (j < m) out[k++] = b[j++];
}
