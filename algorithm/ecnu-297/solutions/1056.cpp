#include <iostream>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int capacity, n;
    while (cin >> capacity >> n) {
        vector<char> reachable(capacity + 1);
        reachable[0] = true;
        for (int i = 0; i < n; ++i) {
            int volume;
            cin >> volume;
            for (int j = capacity; j >= volume; --j)
                if (reachable[j - volume]) reachable[j] = true;
        }
        int used = capacity;
        while (!reachable[used]) --used;
        cout << capacity - used << '\n';
    }
    return 0;
}
